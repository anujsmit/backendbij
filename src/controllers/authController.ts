import { Request, Response, NextFunction } from "express";
import { createOtp, verifyOtp as verifyOtpService } from "../services/otp";
import { sendSms } from "../services/sms";
import { db } from "../db";
import { users, mistriProfiles } from "../db/schema";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";

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