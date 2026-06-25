// backend/src/controllers/authController.ts

import { Request, Response, NextFunction } from "express";
import { createOtp, verifyOtp as verifyOtpService, isReviewAccount } from "../services/otp";
import { sendSms } from "../services/sms";
import { db } from "../db";
import { users, mistriProfiles, refreshTokens, loginAttempts } from "../db/schema"; // ✅ Add loginAttempts
import { eq, and, sql } from "drizzle-orm"; // ✅ Add and, sql
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { createAuditLog } from "../services/auditLog";

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

    const user = await db.query.users.findFirst({
      where: eq(users.id, decoded.userId),
    });

    if (!user) {
      return res.status(404).json({ message: "User not found or deleted" });
    }

    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};

export const sendOtp = async (req: Request, res: Response) => {
  const { phone } = req.body;

  console.log('Send OTP request received:', { phone, type: typeof phone });

  if (!phone) {
    return res.status(400).json({ message: "Phone number is required" });
  }

  try {
    if (isReviewAccount(phone)) {
      return res.status(200).json({ message: "OTP sent successfully" });
    }
    const otp = await createOtp(phone);
    if (process.env.NODE_ENV === 'production') {
      await sendSms(phone, `SERVEX: Your ServeX OTP is: ${otp}. Never share this OTP with anyone.`, "otp_login");
    } else {
      console.log(`📱 Development OTP for ${phone}: ${otp}`);
    }
    res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { phone, otp } = req.body;

  console.log('Verify OTP request received:', { phone, otp, phoneType: typeof phone, otpType: typeof otp });

  if (!phone || !otp) {
    return res.status(400).json({ message: "Phone number and OTP are required" });
  }

  try {
    await verifyOtpService(phone, otp);

    const cleanPhone = phone.replace(/\s+/g, '');

    let user = await db.query.users.findFirst({
      where: eq(users.phoneNumber, cleanPhone),
    });

    if (!user) {
      user = (await db.insert(users).values({ phoneNumber: cleanPhone, fullName: "" }).returning())[0];
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
      expiresIn: "7d",
    });

    let approvalStatus: string | null = null;
    let approvalRejectionReason: string | null = null;
    if (user.role === 'mistri') {
      const [profile] = await db.select({
        approvalStatus: mistriProfiles.approvalStatus,
        approvalRejectionReason: mistriProfiles.approvalRejectionReason,
      }).from(mistriProfiles).where(eq(mistriProfiles.userId, user.id)).limit(1);
      if (profile) {
        approvalStatus = profile.approvalStatus;
        approvalRejectionReason = profile.approvalRejectionReason;
      }
    }

    res.status(200).json({ token, user: { ...user, approvalStatus, approvalRejectionReason } });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: "Invalid or expired OTP" });
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let approvalStatus: string | null = null;
    let approvalRejectionReason: string | null = null;
    if (user.role === 'mistri') {
      const [profile] = await db.select({
        approvalStatus: mistriProfiles.approvalStatus,
        approvalRejectionReason: mistriProfiles.approvalRejectionReason,
      }).from(mistriProfiles).where(eq(mistriProfiles.userId, userId)).limit(1);
      if (profile) {
        approvalStatus = profile.approvalStatus;
        approvalRejectionReason = profile.approvalRejectionReason;
      }
    }

    res.status(200).json({ user: { ...user, approvalStatus, approvalRejectionReason } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to get user profile" });
  }
};

export const setUserRole = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { role } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!role || !['user', 'mistri'].includes(role)) {
      return res.status(400).json({ message: "Valid role is required" });
    }

    const updatedUser = await db.update(users)
      .set({
        role,
        roleSelectedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser.length) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Role set successfully",
      user: updatedUser[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to set user role" });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { fullName, location } = req.body;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return res.status(400).json({ message: "Full name is required" });
    }
    const updateData: Record<string, any> = {
      fullName,
      isOnboarded: true,
      onboardingCompletedAt: new Date(),
    };
    if (location && typeof location === 'string') {
      updateData.defaultLocation = location;
    }
    const result = await db.update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();
    if (!result.length) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user: result[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update profile" });
  }
};

// ✅ Schedule account deletion with password verification
export const scheduleAccountDeletion = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { password } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required"
      });
    }

    // ✅ Check rate limiting - get attempts from database
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const attempts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.userId, userId),
          eq(loginAttempts.attemptType, "account_deletion"),
          eq(loginAttempts.success, false),
          sql`${loginAttempts.createdAt} > ${twentyFourHoursAgo.toISOString()}`
        )
      );

    const attemptCount = attempts[0]?.count || 0;
    const maxAttempts = 10;
    const remaining = Math.max(0, maxAttempts - attemptCount);

    if (attemptCount >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. Please try again in 24 hours.",
        attemptsRemaining: 0,
        lockedUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      });
    }

    // Get user with password hash
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Verify password
    if (!user.passwordHash) {
      return res.status(400).json({
        success: false,
        message: "Password not set. Please use OTP method."
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    
    // ✅ Log the attempt
    await db.insert(loginAttempts).values({
      userId: userId,
      phoneNumber: user.phoneNumber,
      attemptType: "account_deletion",
      success: isValidPassword,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] || null,
    });

    if (!isValidPassword) {
      const newRemaining = Math.max(0, remaining - 1);
      return res.status(401).json({
        success: false,
        message: "Incorrect password. Please try again.",
        attemptsRemaining: newRemaining,
        maxAttempts: maxAttempts
      });
    }

    // Schedule deletion 7 days from now
    const deletionScheduledAt = new Date();
    deletionScheduledAt.setDate(deletionScheduledAt.getDate() + 7);

    // Update user with deletion schedule - use raw SQL for new column
    await db.execute(sql`
      UPDATE users 
      SET deletion_scheduled_at = ${deletionScheduledAt.toISOString()}, 
          is_active = false, 
          updated_at = ${new Date().toISOString()}
      WHERE id = ${userId}
    `);

    // Create audit log
    await createAuditLog({
      entityType: "user",
      entityId: userId,
      action: "account_deletion_scheduled",
      performedBy: userId,
      performedByRole: user.role as any,
      metadata: { deletionScheduledAt: deletionScheduledAt.toISOString() }
    });

    // Invalidate all sessions
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));

    return res.json({
      success: true,
      message: "Account deletion scheduled successfully",
      deletionScheduledAt: deletionScheduledAt.toISOString()
    });
  } catch (error) {
    console.error("Schedule account deletion error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to schedule account deletion"
    });
  }
};

// ✅ Cancel account deletion
export const cancelAccountDeletion = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    // ✅ Use raw SQL for new column
    await db.execute(sql`
      UPDATE users 
      SET deletion_scheduled_at = NULL, 
          is_active = true, 
          updated_at = ${new Date().toISOString()}
      WHERE id = ${userId}
    `);

    await createAuditLog({
      entityType: "user",
      entityId: userId,
      action: "account_deletion_cancelled",
      performedBy: userId,
      performedByRole: (req as any).user?.role as any,
    });

    return res.json({
      success: true,
      message: "Account deletion cancelled"
    });
  } catch (error) {
    console.error("Cancel account deletion error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel account deletion"
    });
  }
};

// ✅ Get deletion status
export const getDeletionStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    // ✅ Use raw SQL for new column
    const result = await db.execute(sql`
      SELECT deletion_scheduled_at 
      FROM users 
      WHERE id = ${userId}
    `);

    const row = (result as unknown as Array<{ deletion_scheduled_at: string | null }>)[0];
    const deletionScheduledAt = row?.deletion_scheduled_at || null;

    return res.json({
      success: true,
      deletionScheduledAt,
      isScheduled: !!deletionScheduledAt,
    });
  } catch (error) {
    console.error("Get deletion status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get deletion status"
    });
  }
};