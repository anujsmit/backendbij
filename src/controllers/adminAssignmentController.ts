// backend/src/controllers/adminAssignmentController.ts
import { Request, Response } from "express";
import { db } from "../db";
import { 
  serviceRequests, 
  users, 
  mistriProfiles, 
  platformServices,
  serviceRequestPlatformServices 
} from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { createNotification } from "./notificationController";
import { createAuditLog } from "../services/auditLog";
import { sendSms } from "../services/sms";
import { shouldSendNotification } from "../services/notificationPreferences";
import { z } from "zod";

const assignRequestSchema = z.object({
  mistriId: z.string().uuid(),
  paymentAmount: z.number().positive(),
  adminNotes: z.string().optional(),
});

// Get all pending approval requests (status = 'pending')
export const getPendingApprovalRequests = async (req: Request, res: Response) => {
  try {
    const pendingRequests = await db
      .select({
        id: serviceRequests.id,
        type: serviceRequests.type,
        address: serviceRequests.address,
        lat: serviceRequests.lat,
        lng: serviceRequests.lng,
        customerNotes: serviceRequests.customerNotes,
        createdAt: serviceRequests.createdAt,
        customerId: serviceRequests.customerId,
        customerName: users.fullName,
        customerPhone: users.phoneNumber,
      })
      .from(serviceRequests)
      .innerJoin(users, eq(serviceRequests.customerId, users.id))
      // FIXED: Use 'pending' instead of 'pending_approval'
      .where(eq(serviceRequests.status, "pending"))
      .orderBy(desc(serviceRequests.createdAt));

    return res.json({
      success: true,
      requests: pendingRequests,
    });
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending requests",
    });
  }
};

// Get single request details for assignment
export const getRequestForAssignment = async (req: Request, res: Response) => {
  try {
    const requestId = req.params.id;

    const request = await db
      .select({
        id: serviceRequests.id,
        type: serviceRequests.type,
        address: serviceRequests.address,
        lat: serviceRequests.lat,
        lng: serviceRequests.lng,
        customerNotes: serviceRequests.customerNotes,
        createdAt: serviceRequests.createdAt,
        customerId: serviceRequests.customerId,
        customerName: users.fullName,
        customerPhone: users.phoneNumber,
      })
      .from(serviceRequests)
      .innerJoin(users, eq(serviceRequests.customerId, users.id))
      .where(eq(serviceRequests.id, requestId))
      .limit(1);

    if (request.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Get platform services for this request
    const platformServicesList = await db
      .select({
        id: platformServices.id,
        name: platformServices.name,
        price: platformServices.price,
      })
      .from(serviceRequestPlatformServices)
      .innerJoin(platformServices, eq(serviceRequestPlatformServices.platformServiceId, platformServices.id))
      .where(eq(serviceRequestPlatformServices.serviceRequestId, requestId));

    return res.json({
      success: true,
      request: request[0],
      platformServices: platformServicesList,
    });
  } catch (error) {
    console.error("Error fetching request details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch request details",
    });
  }
};

// Get available mistris for assignment
export const getAvailableMistrisForAssignment = async (req: Request, res: Response) => {
  try {
    const serviceType = req.query.serviceType as string;
    
    let query = db
      .select({
        id: users.id,
        fullName: users.fullName,
        phoneNumber: users.phoneNumber,
        serviceId: mistriProfiles.serviceId,
        profilePhotoUrl: mistriProfiles.profilePhotoUrl,
        isAvailable: mistriProfiles.isAvailable,
        availabilityStatus: mistriProfiles.availabilityStatus,
        averageRating: mistriProfiles.averageRating,
        jobsCompleted: mistriProfiles.jobsCompleted,
      })
      .from(users)
      .innerJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
      .where(
        and(
          eq(users.role, "mistri"),
          eq(users.isActive, true),
          eq(mistriProfiles.approvalStatus, "approved")
        )
      );

    const mistris = await query
      .orderBy(desc(mistriProfiles.isAvailable), desc(mistriProfiles.averageRating))
      .limit(50);

    return res.json({
      success: true,
      mistris,
    });
  } catch (error) {
    console.error("Error fetching mistris:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch mistris",
    });
  }
};

// Assign mistri to request with payment amount
export const assignMistriToRequest = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    const requestId = req.params.id;
    
    console.log('Assign request received:', { requestId, adminId, body: req.body });
    
    const parsed = assignRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('Validation error:', parsed.error);
      return res.status(400).json({
        success: false,
        message: "Invalid data",
        errors: parsed.error.format(),
      });
    }

    const { mistriId, paymentAmount, adminNotes } = parsed.data;

    // Get the request
    const [request] = await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, requestId))
      .limit(1);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    console.log('Current request status:', request.status);

    // FIXED: Check for 'pending' instead of 'pending_approval'
    if (request.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot assign request with status: ${request.status}. Only pending requests can be assigned.`,
      });
    }

    // Get mistri details
    const [mistri] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        phoneNumber: users.phoneNumber,
      })
      .from(users)
      .where(and(eq(users.id, mistriId), eq(users.role, "mistri")))
      .limit(1);

    if (!mistri) {
      return res.status(404).json({
        success: false,
        message: "Mistri not found",
      });
    }

    // Update the request
    const [updated] = await db
      .update(serviceRequests)
      .set({
        status: "assigned",
        assignedMistriId: mistriId,
        assignedAt: new Date(),
        paymentAmount: paymentAmount.toString(),
        adminNotes: adminNotes || null,
      })
      .where(eq(serviceRequests.id, requestId))
      .returning();

    // Update mistri availability
    await db
      .update(mistriProfiles)
      .set({
        availabilityStatus: "unavailable",
        isAvailable: false,
      })
      .where(eq(mistriProfiles.userId, mistriId));

    // Notify mistri
    await createNotification(
      mistriId,
      "New Service Request Assigned",
      `You have been assigned a ${request.type} service request at ${request.address}. Payment: NPR ${paymentAmount.toLocaleString()}`,
      "new_request",
      requestId
    );

    // Notify customer
    await createNotification(
      request.customerId,
      "Service Request Approved",
      `Your ${request.type} service request has been approved and assigned to ${mistri.fullName}. Payment: NPR ${paymentAmount.toLocaleString()}`,
      "request_assigned",
      requestId
    );

    // Send SMS to customer
    const customer = await db.query.users.findFirst({
      where: eq(users.id, request.customerId),
    });

    const shouldSendSms = await shouldSendNotification(request.customerId, "request_assigned", "sms");
    if (customer?.phoneNumber && shouldSendSms) {
      try {
        await sendSms(
          customer.phoneNumber,
          `SERVEX: Your ${request.type} service request has been approved! ${mistri.fullName} will contact you shortly. Payment: NPR ${paymentAmount.toLocaleString()}`,
          "service_assigned"
        );
      } catch (smsError) {
        console.error("Failed to send SMS:", smsError);
      }
    }

    // Create audit log
    await createAuditLog({
      entityType: "service_request",
      entityId: requestId,
      action: "admin_assign",
      performedBy: adminId!,
      performedByRole: "admin",
      oldValue: { status: "pending", assignedMistriId: null },
      newValue: { status: "assigned", assignedMistriId: mistriId, paymentAmount },
      metadata: { adminNotes },
    });

    return res.json({
      success: true,
      message: "Request assigned successfully",
      request: updated,
    });
  } catch (error) {
    console.error("Error assigning request:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to assign request",
    });
  }
};

// Reject pending request
export const rejectPendingRequest = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    const requestId = req.params.id;
    const { reason } = req.body;

    const [request] = await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, requestId))
      .limit(1);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    // FIXED: Check for 'pending' instead of 'pending_approval'
    if (request.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot reject request with status: ${request.status}`,
      });
    }

    await db
      .update(serviceRequests)
      .set({
        status: "canceled",
        adminNotes: reason || null,
      })
      .where(eq(serviceRequests.id, requestId));

    // Notify customer
    await createNotification(
      request.customerId,
      "Service Request Rejected",
      `Your ${request.type} service request has been rejected. Reason: ${reason || "Not specified"}. Please contact support for more information.`,
      "request_rejected",
      requestId
    );

    await createAuditLog({
      entityType: "service_request",
      entityId: requestId,
      action: "admin_reject",
      performedBy: adminId!,
      performedByRole: "admin",
      oldValue: { status: "pending" },
      newValue: { status: "canceled" },
      metadata: { reason },
    });

    return res.json({
      success: true,
      message: "Request rejected successfully",
    });
  } catch (error) {
    console.error("Error rejecting request:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reject request",
    });
  }
};

// Get all requests with status (for history)
export const getAllRequests = async (req: Request, res: Response) => {
  try {
    const { status, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let whereCondition = undefined;
    if (status && status !== "all") {
      whereCondition = eq(serviceRequests.status, status as any);
    }

    // First, get the requests with mistri names
    const requests = await db
      .select({
        id: serviceRequests.id,
        type: serviceRequests.type,
        address: serviceRequests.address,
        status: serviceRequests.status,
        paymentAmount: serviceRequests.paymentAmount,
        createdAt: serviceRequests.createdAt,
        assignedAt: serviceRequests.assignedAt,
        completedAt: serviceRequests.completedAt,
        customerName: users.fullName,
        customerPhone: users.phoneNumber,
        assignedMistriId: serviceRequests.assignedMistriId,
      })
      .from(serviceRequests)
      .innerJoin(users, eq(serviceRequests.customerId, users.id))
      .where(whereCondition)
      .orderBy(desc(serviceRequests.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get mistri names separately
    const requestsWithMistri = await Promise.all(
      requests.map(async (request) => {
        let mistriName = null;
        if (request.assignedMistriId) {
          const mistri = await db.query.users.findFirst({
            where: eq(users.id, request.assignedMistriId!),
          });
          mistriName = mistri?.fullName || null;
        }
        return {
          ...request,
          mistriName,
        };
      })
    );

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(serviceRequests)
      .where(whereCondition);

    const total = countResult[0]?.count || 0;

    return res.json({
      success: true,
      requests: requestsWithMistri,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    });
  } catch (error) {
    console.error("Error fetching requests:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch requests",
    });
  }
};