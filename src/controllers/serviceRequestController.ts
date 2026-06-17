// backend/src/controllers/serviceRequestController.ts
import { Request, Response } from "express";
import { and, eq, desc, sql, inArray, gte, lt, lte, gt } from "drizzle-orm";
import { db } from "../db";
import { 
  serviceRequests, 
  users, 
  mistriProfiles, 
  services, 
  platformServices, 
  serviceRequestPlatformServices 
} from "../db/schema";
import { z } from "zod";
import { createNotification } from "./notificationController";
import { createAuditLog } from "../services/auditLog";
import { sendSms } from "../services/sms";
import { shouldSendNotification } from "../services/notificationPreferences";
import { initiateDispatch, stopDispatch } from "../services/dispatch";
import { cacheService } from "../services/cacheService";

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Simplified schema - only include fields that exist in your database
const createServiceRequestSchema = z.object({
  type: z.string(),
  platformServiceIds: z.array(z.string().uuid()).optional(),
  coords: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  address: z.string(),
  source: z.enum(["gps", "drag"]),
  selectedMistriId: z.string().uuid().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
});

export const createServiceRequest = async (req: Request, res: Response) => {
  try {
    console.log('📝 Create service request - Request body:', JSON.stringify(req.body, null, 2));
    
    const validatedData = createServiceRequestSchema.safeParse(req.body);

    if (!validatedData.success) {
      console.error('❌ Validation error:', validatedData.error.format());
      return res.status(400).json({
        success: false,
        message: "Invalid request data",
        errors: validatedData.error.format(),
      });
    }

    const { type, platformServiceIds, coords, address, source, customerNotes, selectedMistriId } = validatedData.data;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    console.log('👤 User ID:', userId);
    console.log('📦 Service type:', type);
    console.log('📍 Address:', address);

    // Validate service type exists
    const serviceExists = await db.select().from(services).where(
      and(
        eq(services.serviceName, type),
        eq(services.isActive, true)
      )
    );

    if (serviceExists.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid service type: ${type}`,
      });
    }

    // Create request with pending status
    const insertData: any = {
      customerId: userId,
      type: type,
      lat: coords.lat.toString(),
      lng: coords.lng.toString(),
      address: address,
      source: source,
      status: "pending",
      assignedMistriId: selectedMistriId || null,
      customerNotes: customerNotes || null,
    };

    console.log('📝 Insert data:', insertData);

    const result = await db.insert(serviceRequests).values(insertData).returning();
    const newRequest = result[0];

    console.log('✅ Request created with ID:', newRequest.id);

    // Add platform services if selected
    if (platformServiceIds && platformServiceIds.length > 0) {
      const validServices = await db
        .select()
        .from(platformServices)
        .where(
          and(
            inArray(platformServices.id, platformServiceIds),
            eq(platformServices.isActive, true)
          )
        );

      if (validServices.length > 0) {
        const junctionEntries = validServices.map(service => ({
          serviceRequestId: newRequest.id,
          platformServiceId: service.id,
        }));
        await db.insert(serviceRequestPlatformServices).values(junctionEntries);
        console.log(`📎 Added ${junctionEntries.length} platform services`);
      }
    }

    // Notify admins
    const admins = await db.query.users.findMany({
      where: eq(users.role, "admin"),
    });

    for (const admin of admins) {
      await createNotification(
        admin.id,
        "New Service Request",
        `Customer requested ${type} service at ${address.substring(0, 100)}`,
        "admin_new_request",
        newRequest.id
      );
    }

    console.log(`📧 Notified ${admins.length} admins`);

    return res.status(201).json({
      success: true,
      message: "Service request submitted successfully",
      requestId: newRequest.id,
      status: "pending",
    });
  } catch (error) {
    console.error("❌ Error creating service request:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create service request: " + (error as Error).message,
    });
  }
};

export const cancelServiceRequest = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const serviceRequest = await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, id))
      .limit(1);

    if (!serviceRequest.length) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    if (serviceRequest[0].customerId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this request",
      });
    }

    const currentStatus = serviceRequest[0].status;
    if (currentStatus !== 'pending' && currentStatus !== 'assigned') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel request with status '${currentStatus}'. Only pending or assigned requests can be canceled.`,
      });
    }

    const [updatedRequest] = await db
      .update(serviceRequests)
      .set({
        status: "canceled",
      })
      .where(eq(serviceRequests.id, id))
      .returning();

    stopDispatch(id);

    await createAuditLog({
      entityType: 'service_request',
      entityId: id,
      action: 'cancel',
      performedBy: userId,
      performedByRole: (req.user?.role as 'user' | 'mistri' | 'admin') || 'user',
      oldValue: { status: currentStatus },
      newValue: { status: 'canceled' },
      metadata: { canceledAt: new Date().toISOString() }
    });

    return res.status(200).json({
      success: true,
      message: "Service request canceled successfully",
      requestId: updatedRequest.id,
    });
  } catch (error) {
    console.error("Error canceling service request:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel service request",
    });
  }
};

export const getUserServiceRequests = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const requests = await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.customerId, userId))
      .orderBy(desc(serviceRequests.createdAt));

    return res.status(200).json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("Error fetching service requests:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service requests",
    });
  }
};

export const getServiceRequestById = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = req.params.id as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const results = await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, id))
      .limit(1);

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "Service request not found" });
    }

    const requestRow = results[0];

    const isOwner = requestRow.customerId === userId;
    const isAssignedMistri = requestRow.assignedMistriId === userId;

    if (!isOwner && !isAssignedMistri) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const selectedServices = await db
      .select({
        id: platformServices.id,
        name: platformServices.name,
        description: platformServices.description,
        price: platformServices.price,
        imageUrl: platformServices.imageUrl,
      })
      .from(serviceRequestPlatformServices)
      .innerJoin(platformServices, eq(serviceRequestPlatformServices.platformServiceId, platformServices.id))
      .where(eq(serviceRequestPlatformServices.serviceRequestId, id));

    let response: any = {
      success: true,
      request: requestRow,
      selectedServices,
    };

    if (requestRow.assignedMistriId) {
      const mistriInfo = await db
        .select({
          name: users.fullName,
          phone: users.phoneNumber,
          id: users.id,
          profilePhotoUrl: mistriProfiles.profilePhotoUrl,
          averageRating: mistriProfiles.averageRating,
          jobsCompleted: mistriProfiles.jobsCompleted,
        })
        .from(users)
        .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
        .where(eq(users.id, requestRow.assignedMistriId))
        .limit(1);

      if (isOwner && mistriInfo.length > 0) {
        const includePhone = requestRow.status === 'assigned' || requestRow.status === 'completed';
        response.mistriDetails = {
          id: mistriInfo[0].id,
          name: mistriInfo[0].name,
          phone: includePhone ? mistriInfo[0].phone : null,
          profilePhotoUrl: mistriInfo[0].profilePhotoUrl,
          averageRating: mistriInfo[0].averageRating,
          jobsCompleted: mistriInfo[0].jobsCompleted,
        };
      }
    }

    if ((requestRow.status === 'assigned' || requestRow.status === 'completed') && requestRow.assignedMistriId) {
      const customerInfo = await db
        .select({
          name: users.fullName,
          phone: users.phoneNumber,
          id: users.id,
        })
        .from(users)
        .where(eq(users.id, requestRow.customerId))
        .limit(1);

      if (isAssignedMistri && customerInfo.length > 0) {
        response.customerDetails = {
          id: customerInfo[0].id,
          name: customerInfo[0].name,
          phone: customerInfo[0].phone,
        };
      }
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching service request by id:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch service request" });
  }
};

export const acceptServiceRequest = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = req.params.id as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }
    if (role !== 'mistri') {
      return res.status(403).json({ success: false, message: "Only mistri users can accept requests" });
    }

    const activeJobs = await db.select()
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.assignedMistriId, userId),
          eq(serviceRequests.status, 'assigned')
        )
      );

    if (activeJobs.length > 0) {
      return res.status(409).json({
        success: false,
        message: "You already have an active job. Complete it before accepting new requests.",
        activeJobId: activeJobs[0].id
      });
    }

    const existing = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Service request not found" });
    }
    const reqRow = existing[0];
    if (reqRow.status !== 'pending') {
      return res.status(400).json({ success: false, message: "Only pending requests can be accepted" });
    }

    if (reqRow.assignedMistriId && reqRow.assignedMistriId !== userId) {
      return res.status(409).json({ success: false, message: "Request assigned to another mistri" });
    }

    const [updated] = await db
      .update(serviceRequests)
      .set({
        status: 'assigned',
        assignedMistriId: userId,
        assignedAt: new Date(),
      })
      .where(eq(serviceRequests.id, id))
      .returning();

    await db.update(mistriProfiles)
      .set({
        availabilityStatus: 'unavailable',
        isAvailable: false
      })
      .where(eq(mistriProfiles.userId, userId));

    stopDispatch(id);

    const mistri = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    await createNotification(
      reqRow.customerId,
      'Service Request Accepted',
      `${mistri?.fullName || 'A mistri'} has accepted your ${reqRow.type} service request.`,
      'request_accepted',
      id
    );

    await createAuditLog({
      entityType: 'service_request',
      entityId: id,
      action: 'status_change',
      performedBy: userId,
      performedByRole: 'mistri',
      oldValue: { status: 'pending', assignedMistriId: reqRow.assignedMistriId },
      newValue: { status: 'assigned', assignedMistriId: userId },
      metadata: { assignedAt: new Date().toISOString() }
    });

    const customer = await db.query.users.findFirst({
      where: eq(users.id, reqRow.customerId),
    });

    const shouldSendSms = await shouldSendNotification(reqRow.customerId, 'request_accepted', 'sms');

    if (customer?.phoneNumber && shouldSendSms) {
      try {
        await sendSms(
          customer.phoneNumber,
          `SERVEX: ${mistri?.fullName || 'A mistri'} has accepted your ${reqRow.type} service request at ${reqRow.address}. Contact: ${mistri?.phoneNumber || 'N/A'}`,
          "service_accepted"
        );
      } catch (smsError) {
        console.error('Failed to send acceptance SMS:', smsError);
      }
    }

    return res.status(200).json({ success: true, message: "Request accepted", request: updated });
  } catch (error) {
    console.error("Error accepting service request:", error);
    return res.status(500).json({ success: false, message: "Failed to accept request" });
  }
};

export const declineServiceRequest = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = req.params.id as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }
    if (role !== 'mistri') {
      return res.status(403).json({ success: false, message: "Only mistri users can decline requests" });
    }

    const existing = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Service request not found" });
    }
    const reqRow = existing[0];
    if (reqRow.status !== 'pending') {
      return res.status(400).json({ success: false, message: "Only pending requests can be declined" });
    }

    if (reqRow.assignedMistriId !== userId) {
      return res.status(403).json({ success: false, message: "You are not assigned to this request" });
    }

    const [updated] = await db
      .update(serviceRequests)
      .set({ assignedMistriId: null })
      .where(eq(serviceRequests.id, id))
      .returning();

    const mistri = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    await createNotification(
      reqRow.customerId,
      'Service Request Declined',
      `${mistri?.fullName || 'The mistri'} has declined your ${reqRow.type} service request. You can select another mistri.`,
      'request_declined',
      id
    );

    await createAuditLog({
      entityType: 'service_request',
      entityId: id,
      action: 'decline',
      performedBy: userId,
      performedByRole: 'mistri',
      oldValue: { assignedMistriId: userId },
      newValue: { assignedMistriId: null },
      metadata: { declinedAt: new Date().toISOString() }
    });

    return res.status(200).json({
      success: true,
      message: "Request declined. Customer can now select another mistri.",
      request: updated
    });
  } catch (error) {
    console.error("Error declining service request:", error);
    return res.status(500).json({ success: false, message: "Failed to decline request" });
  }
};

export const getPendingServiceRequests = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user.length || user[0].role !== 'mistri') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only mistri users can view pending requests."
      });
    }

    const cacheKey = `pending_requests:${userId}`;
    let requests = await cacheService.get(cacheKey);

    if (!requests) {
      requests = await db
        .select()
        .from(serviceRequests)
        .where(eq(serviceRequests.status, 'pending'))
        .orderBy(desc(serviceRequests.createdAt));
      
      await cacheService.set(cacheKey, requests, 30);
    }

    return res.status(200).json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("Error fetching pending service requests:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending service requests",
    });
  }
};

export const getMistriAssignedRequests = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user.length || user[0].role !== 'mistri') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only mistri users can view assigned requests."
      });
    }

    const assignedRequests = await db
      .select()
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.assignedMistriId, userId),
          eq(serviceRequests.status, 'assigned')
        )
      )
      .orderBy(desc(serviceRequests.createdAt));

    return res.status(200).json({
      success: true,
      requests: assignedRequests,
    });
  } catch (error) {
    console.error("Error fetching mistri assigned requests:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch assigned requests",
    });
  }
};

export const completeServiceRequest = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = req.params.id as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }
    if (role !== 'mistri') {
      return res.status(403).json({ success: false, message: "Only mistri users can complete requests" });
    }

    const existing = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Service request not found" });
    }

    const reqRow = existing[0];

    if (reqRow.assignedMistriId !== userId) {
      return res.status(403).json({ success: false, message: "You are not assigned to this request" });
    }

    if (reqRow.status !== 'assigned') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete request with status '${reqRow.status}'. Only assigned requests can be completed.`,
      });
    }

    const [updated] = await db
      .update(serviceRequests)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(serviceRequests.id, id))
      .returning();

    await db
      .update(mistriProfiles)
      .set({
        jobsCompleted: sql`${mistriProfiles.jobsCompleted} + 1`,
        availabilityStatus: 'available',
        isAvailable: true
      })
      .where(eq(mistriProfiles.userId, userId));

    await createAuditLog({
      entityType: 'service_request',
      entityId: id,
      action: 'status_change',
      performedBy: userId,
      performedByRole: 'mistri',
      oldValue: { status: 'assigned', completedAt: null },
      newValue: { status: 'completed', completedAt: new Date().toISOString() },
      metadata: { jobsCompletedIncrement: 1 }
    });

    const customer = await db.query.users.findFirst({
      where: eq(users.id, reqRow.customerId),
    });

    const shouldSendCompletionSms = await shouldSendNotification(reqRow.customerId, 'request_completed', 'sms');

    if (customer?.phoneNumber && shouldSendCompletionSms) {
      try {
        await sendSms(
          customer.phoneNumber,
          `SERVEX: Your ${reqRow.type} service request at ${reqRow.address} has been marked as complete. Thank you for using ServeX!`,
          "service_completed"
        );
      } catch (smsError) {
        console.error('Failed to send completion SMS:', smsError);
      }
    }

    await cacheService.del(`pending_requests:*`);
    await cacheService.del(`nearby_mistris:*`);

    return res.status(200).json({
      success: true,
      message: "Job marked as completed",
      request: updated
    });
  } catch (error) {
    console.error("Error completing service request:", error);
    return res.status(500).json({ success: false, message: "Failed to complete request" });
  }
};

export const toggleUnpaidServiceRequest = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = req.params.id as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }
    if (role !== 'mistri') {
      return res.status(403).json({ success: false, message: "Only mistri users can toggle unpaid status" });
    }

    const existing = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Service request not found" });
    }

    const reqRow = existing[0];

    if (reqRow.assignedMistriId !== userId) {
      return res.status(403).json({ success: false, message: "You are not assigned to this request" });
    }

    if (reqRow.status !== 'completed' && reqRow.status !== 'assigned') {
      return res.status(400).json({
        success: false,
        message: `Cannot toggle unpaid status for request with status '${reqRow.status}'.`,
      });
    }

    const [updated] = await db
      .update(serviceRequests)
      .set({
        unpaid: !reqRow.unpaid,
      })
      .where(eq(serviceRequests.id, id))
      .returning();

    await createAuditLog({
      entityType: 'service_request',
      entityId: id,
      action: 'unpaid_toggle',
      performedBy: userId,
      performedByRole: 'mistri',
      oldValue: { unpaid: reqRow.unpaid },
      newValue: { unpaid: !reqRow.unpaid },
      metadata: { toggledAt: new Date().toISOString() }
    });

    return res.status(200).json({
      success: true,
      message: `Unpaid status ${updated.unpaid ? 'enabled' : 'disabled'}`,
      request: updated
    });
  } catch (error) {
    console.error("Error toggling unpaid status:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle unpaid status" });
  }
};

export const startWork = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = req.params.id as string;

    if (!userId || role !== 'mistri') {
      return res.status(403).json({
        success: false,
        message: "Only mistris can start work"
      });
    }

    const existing = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Service request not found" });
    }

    const reqRow = existing[0];

    if (reqRow.assignedMistriId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this request"
      });
    }

    if (reqRow.status !== 'assigned') {
      return res.status(400).json({
        success: false,
        message: "Can only start work on assigned requests"
      });
    }

    if (reqRow.startedWorkAt) {
      return res.status(400).json({
        success: false,
        message: "Work already started",
        startedAt: reqRow.startedWorkAt
      });
    }

    const [updated] = await db
      .update(serviceRequests)
      .set({ startedWorkAt: new Date() })
      .where(eq(serviceRequests.id, id))
      .returning();

    await createAuditLog({
      entityType: 'service_request',
      entityId: id,
      action: 'start_work',
      performedBy: userId,
      performedByRole: 'mistri',
      oldValue: { startedWorkAt: null },
      newValue: { startedWorkAt: new Date().toISOString() },
      metadata: {}
    });

    return res.json({
      success: true,
      message: "Work started",
      request: updated
    });
  } catch (error) {
    console.error("Error starting work:", error);
    return res.status(500).json({ success: false, message: "Failed to start work" });
  }
};

export const getJobHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || role !== 'mistri') {
      return res.status(403).json({
        success: false,
        message: "Only mistris can access job history"
      });
    }

    const {
      startDate,
      endDate,
      status,
      serviceType,
      search,
      page = '1',
      limit = '20'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(serviceRequests.assignedMistriId, userId)];

    if (startDate) {
      conditions.push(sql`${serviceRequests.createdAt} >= ${new Date(startDate as string)}`);
    }

    if (endDate) {
      conditions.push(sql`${serviceRequests.createdAt} <= ${new Date(endDate as string)}`);
    }

    if (status) {
      conditions.push(eq(serviceRequests.status, status as any));
    }

    if (serviceType) {
      conditions.push(eq(serviceRequests.type, serviceType as string));
    }

    if (search) {
      conditions.push(
        sql`${serviceRequests.address} ILIKE ${'%' + (search as string) + '%'}
          OR ${serviceRequests.customerNotes} ILIKE ${'%' + (search as string) + '%'}`
      );
    }

    const jobs = await db
      .select({
        id: serviceRequests.id,
        type: serviceRequests.type,
        address: serviceRequests.address,
        status: serviceRequests.status,
        customerNotes: serviceRequests.customerNotes,
        unpaid: serviceRequests.unpaid,
        createdAt: serviceRequests.createdAt,
        assignedAt: serviceRequests.assignedAt,
        startedWorkAt: serviceRequests.startedWorkAt,
        completedAt: serviceRequests.completedAt,
        customerName: users.fullName,
        customerId: serviceRequests.customerId,
      })
      .from(serviceRequests)
      .innerJoin(users, eq(serviceRequests.customerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(serviceRequests.createdAt))
      .limit(limitNum)
      .offset(offset);

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(serviceRequests)
      .where(and(...conditions));

    const total = totalResult[0]?.count || 0;

    const jobsWithDuration = jobs.map(job => {
      let durationMinutes = null;
      if (job.completedAt && job.startedWorkAt) {
        const duration = new Date(job.completedAt).getTime() - new Date(job.startedWorkAt).getTime();
        durationMinutes = Math.round(duration / 60000);
      }
      return {
        ...job,
        durationMinutes
      };
    });

    return res.json({
      success: true,
      jobs: jobsWithDuration,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error("Error fetching job history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch job history"
    });
  }
};

export const getJobStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || role !== 'mistri') {
      return res.status(403).json({
        success: false,
        message: "Only mistris can access job statistics"
      });
    }

    const { period = 'month' } = req.query;

    const now = new Date();
    let startDate: Date;

    if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'year') {
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const jobs = await db
      .select()
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.assignedMistriId, userId),
          sql`${serviceRequests.createdAt} >= ${startDate}`
        )
      );

    const stats = {
      totalJobs: jobs.length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      canceledJobs: jobs.filter(j => j.status === 'canceled').length,
      unpaidJobs: jobs.filter(j => j.unpaid).length,
      jobsByServiceType: {} as Record<string, number>,
      averageDurationMinutes: 0,
      totalEarningsEstimate: 0
    };

    jobs.forEach(job => {
      stats.jobsByServiceType[job.type] = (stats.jobsByServiceType[job.type] || 0) + 1;
    });

    const completedWithDuration = jobs.filter(j =>
      j.status === 'completed' && j.startedWorkAt && j.completedAt
    );

    if (completedWithDuration.length > 0) {
      const totalDuration = completedWithDuration.reduce((sum, job) => {
        const duration = new Date(job.completedAt!).getTime() - new Date(job.startedWorkAt!).getTime();
        return sum + duration;
      }, 0);
      stats.averageDurationMinutes = Math.round(totalDuration / completedWithDuration.length / 60000);
    }

    return res.json({
      success: true,
      period,
      startDate,
      endDate: now,
      stats
    });
  } catch (error) {
    console.error("Error fetching job statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch job statistics"
    });
  }
};

export const getEarnings = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || role !== 'mistri') {
      return res.status(403).json({
        success: false,
        message: "Only mistris can access earnings data"
      });
    }

    const { period = 'month', page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    const now = new Date();
    let startDate: Date;

    if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'year') {
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    } else if (period === 'all') {
      startDate = new Date(0);
    } else {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const completedJobs = await db
      .select({
        id: serviceRequests.id,
        type: serviceRequests.type,
        customerId: serviceRequests.customerId,
        customerName: users.fullName,
        completedAt: serviceRequests.completedAt,
        paidAt: serviceRequests.paidAt,
        paymentAmount: serviceRequests.paymentAmount,
        unpaid: serviceRequests.unpaid,
      })
      .from(serviceRequests)
      .innerJoin(users, eq(serviceRequests.customerId, users.id))
      .where(
        and(
          eq(serviceRequests.assignedMistriId, userId),
          eq(serviceRequests.status, 'completed'),
          gte(serviceRequests.completedAt, startDate)
        )
      )
      .orderBy(desc(serviceRequests.completedAt));

    const jobsWithServices = await Promise.all(
      completedJobs.map(async (job) => {
        const services = await db
          .select({
            id: platformServices.id,
            name: platformServices.name,
            price: platformServices.price,
          })
          .from(serviceRequestPlatformServices)
          .innerJoin(platformServices, eq(serviceRequestPlatformServices.platformServiceId, platformServices.id))
          .where(eq(serviceRequestPlatformServices.serviceRequestId, job.id));

        const calculatedAmount = services.reduce((sum, svc) => {
          return sum + parseFloat(svc.price || '0');
        }, 0);

        const amount = job.paymentAmount ? parseFloat(job.paymentAmount) : calculatedAmount;

        const isPaid = !!job.paidAt || !job.unpaid;

        return {
          id: job.id,
          type: job.type,
          customerName: job.customerName,
          amount,
          completedAt: job.completedAt,
          paidAt: job.paidAt,
          isPaid,
          services: services.map(s => ({
            name: s.name,
            price: parseFloat(s.price || '0')
          }))
        };
      })
    );

    const totalEarnings = jobsWithServices.reduce((sum, job) => sum + job.amount, 0);
    const paidEarnings = jobsWithServices
      .filter(job => job.isPaid)
      .reduce((sum, job) => sum + job.amount, 0);
    const unpaidEarnings = totalEarnings - paidEarnings;
    const paidJobs = jobsWithServices.filter(job => job.isPaid).length;
    const unpaidJobs = jobsWithServices.length - paidJobs;
    const averagePerJob = jobsWithServices.length > 0 ? totalEarnings / jobsWithServices.length : 0;

    const trendMap = new Map<string, { amount: number, jobCount: number }>();

    jobsWithServices.forEach(job => {
      if (!job.completedAt) return;

      const dateKey = new Date(job.completedAt).toISOString().split('T')[0];
      const existing = trendMap.get(dateKey) || { amount: 0, jobCount: 0 };
      trendMap.set(dateKey, {
        amount: existing.amount + job.amount,
        jobCount: existing.jobCount + 1
      });
    });

    const trend = Array.from(trendMap.entries())
      .map(([date, data]) => ({
        date,
        amount: data.amount,
        jobCount: data.jobCount
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const paginatedJobs = jobsWithServices.slice(offset, offset + limitNum);

    return res.json({
      success: true,
      period,
      summary: {
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        paidEarnings: Math.round(paidEarnings * 100) / 100,
        unpaidEarnings: Math.round(unpaidEarnings * 100) / 100,
        totalJobs: jobsWithServices.length,
        paidJobs,
        unpaidJobs,
        averagePerJob: Math.round(averagePerJob * 100) / 100
      },
      trend,
      jobs: paginatedJobs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: jobsWithServices.length,
        totalPages: Math.ceil(jobsWithServices.length / limitNum)
      }
    });
  } catch (error) {
    console.error("Error fetching earnings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch earnings data"
    });
  }
};

export const markJobAsPaid = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = req.params.id as string;

    if (!userId || role !== 'mistri') {
      return res.status(403).json({
        success: false,
        message: "Only mistris can mark jobs as paid"
      });
    }

    const [serviceRequest] = await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, id))
      .limit(1);

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: "Service request not found"
      });
    }

    if (serviceRequest.assignedMistriId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only mark your own jobs as paid"
      });
    }

    if (serviceRequest.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: "Only completed jobs can be marked as paid"
      });
    }

    if (serviceRequest.paidAt) {
      await db
        .update(serviceRequests)
        .set({
          paidAt: null,
          unpaid: true
        })
        .where(eq(serviceRequests.id, id));

      await createAuditLog({
        entityType: 'service_request',
        entityId: id,
        action: 'payment_unmarked',
        performedBy: userId,
        performedByRole: role,
        oldValue: { paidAt: serviceRequest.paidAt },
        newValue: { paidAt: null },
        metadata: { message: 'Job marked as unpaid' }
      });

      return res.json({
        success: true,
        message: "Job marked as unpaid",
        isPaid: false
      });
    }

    let paymentAmount = serviceRequest.paymentAmount;

    if (!paymentAmount) {
      const servicesList = await db
        .select({
          price: platformServices.price,
        })
        .from(serviceRequestPlatformServices)
        .innerJoin(platformServices, eq(serviceRequestPlatformServices.platformServiceId, platformServices.id))
        .where(eq(serviceRequestPlatformServices.serviceRequestId, id));

      const calculatedAmount = servicesList.reduce((sum, svc) => {
        return sum + parseFloat(svc.price || '0');
      }, 0);

      paymentAmount = calculatedAmount.toString();
    }

    const now = new Date();
    await db
      .update(serviceRequests)
      .set({
        paidAt: now,
        paymentAmount: paymentAmount,
        unpaid: false
      })
      .where(eq(serviceRequests.id, id));

    await createAuditLog({
      entityType: 'service_request',
      entityId: id,
      action: 'payment_marked',
      performedBy: userId,
      performedByRole: role,
      oldValue: { paidAt: null },
      newValue: { paidAt: now, paymentAmount },
      metadata: { message: 'Job marked as paid' }
    });

    return res.json({
      success: true,
      message: "Job marked as paid",
      isPaid: true,
      paidAt: now,
      amount: parseFloat(paymentAmount)
    });
  } catch (error) {
    console.error("Error marking job as paid:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark job as paid"
    });
  }
};