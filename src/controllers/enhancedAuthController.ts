import { Request, Response, NextFunction } from "express";
import { createOtp, verifyOtp as verifyOtpService } from "../services/otp";
import { sendSms } from "../services/sms";
import { db } from "../db";
import { users, refreshTokens, phoneChangeAttempts, mistriProfiles } from "../db/schema";
import { eq, and, gt, gte, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '30d';
const MAX_PHONE_CHANGES_PER_DAY = 5;

const generateTokens = async (userId: string) => {
    const now = Math.floor(Date.now() / 1000);
    const accessTokenExpiry = now + 60 * 60;
    const refreshTokenExpiry = now + 30 * 24 * 60 * 60;

    const accessToken = jwt.sign({ userId, type: 'access' }, process.env.JWT_SECRET!, {
        expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    const refreshTokenValue = randomBytes(40).toString('hex');
    const expiresAtDate = new Date(refreshTokenExpiry * 1000);

    await db.insert(refreshTokens).values({
        token: refreshTokenValue,
        userId,
        expiresAt: expiresAtDate,
    }).onConflictDoNothing();

    return {
        accessToken,
        refreshToken: refreshTokenValue,
        expiresAt: accessTokenExpiry * 1000,
    };
};

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access token required" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; type?: string };

        if (decoded.type && decoded.type !== 'access') {
            return res.status(403).json({ message: "Invalid token type" });
        }

        const user = await db.query.users.findFirst({
            where: eq(users.id, decoded.userId),
        });

        if (!user) {
            return res.status(404).json({ message: "User not found or deleted" });
        }

        (req as any).user = { userId: decoded.userId };
        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ message: "Token expired" });
        }

        return res.status(403).json({ message: "Invalid token" });
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

        const tokens = await generateTokens(user.id);

        let approvalStatus: string | null = null;
        let approvalRejectionReason: string | null = null;
        if (user.role === "mistri") {
            const [profile] = await db
                .select({
                    approvalStatus: mistriProfiles.approvalStatus,
                    approvalRejectionReason: mistriProfiles.approvalRejectionReason,
                })
                .from(mistriProfiles)
                .where(eq(mistriProfiles.userId, user.id))
                .limit(1);
            if (profile) {
                approvalStatus = profile.approvalStatus;
                approvalRejectionReason = profile.approvalRejectionReason;
            }
        }

        res.status(200).json({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            token: tokens.accessToken,
            user: { ...user, approvalStatus, approvalRejectionReason },
        });
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
        if (user.role === "mistri") {
            const [profile] = await db
                .select({
                    approvalStatus: mistriProfiles.approvalStatus,
                    approvalRejectionReason: mistriProfiles.approvalRejectionReason,
                })
                .from(mistriProfiles)
                .where(eq(mistriProfiles.userId, userId))
                .limit(1);
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
        const { fullName } = req.body;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
            return res.status(400).json({ message: "Full name is required" });
        }
        const result = await db.update(users)
            .set({ fullName, isOnboarded: true, onboardingCompletedAt: new Date() })
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

export const refreshToken = async (req: Request, res: Response) => {
    const { refreshToken: refreshTokenValue } = req.body;

    if (!refreshTokenValue) {
        return res.status(400).json({ message: "Refresh token is required" });
    }

    try {
        const storedTokens = await db.select().from(refreshTokens).where(
            and(
                eq(refreshTokens.token, refreshTokenValue),
                gt(refreshTokens.expiresAt, new Date())
            )
        ).limit(1);

        if (storedTokens.length === 0) {
            return res.status(403).json({ message: "Invalid or expired refresh token" });
        }

        const storedToken = storedTokens[0];

        const user = await db.query.users.findFirst({
            where: eq(users.id, storedToken.userId),
        });

        if (!user) {
            await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshTokenValue));
            return res.status(404).json({ message: "User not found" });
        }

        await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshTokenValue));

        const tokens = await generateTokens(user.id);

        res.status(200).json({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ message: "Failed to refresh token" });
    }
};

export const logout = async (req: Request, res: Response) => {
    const { refreshToken: refreshTokenValue } = req.body;

    if (refreshTokenValue) {
        await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshTokenValue));
    }

    res.status(200).json({ message: "Successfully logged out" });
};

export const requestPhoneChange = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { newPhoneNumber } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!newPhoneNumber) {
            return res.status(400).json({ message: "New phone number is required" });
        }

        // Get current user
        const currentUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

        // Check rate limit - count successful changes in last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentChanges = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(phoneChangeAttempts)
            .where(
                and(
                    eq(phoneChangeAttempts.userId, userId),
                    eq(phoneChangeAttempts.status, 'success'),
                    gte(phoneChangeAttempts.createdAt, oneDayAgo)
                )
            );

        const changeCount = recentChanges[0]?.count || 0;

        if (changeCount >= MAX_PHONE_CHANGES_PER_DAY) {
            return res.status(429).json({
                message: "Rate limit exceeded. You can only change your phone number 5 times per day. Please try again later.",
                retryAfter: 24 * 60 * 60
            });
        }

        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.phoneNumber, newPhoneNumber))
            .limit(1);

        if (existingUser.length > 0 && existingUser[0].id !== userId) {
            return res.status(400).json({
                message: "This phone number is already registered with another account. Please use a different number or contact support if you believe this is an error."
            });
        }

        const otp = await createOtp(newPhoneNumber);
        if (process.env.NODE_ENV === 'production') {
            await sendSms(newPhoneNumber, `SERVEX: Your OTP for phone number change is: ${otp}`, "otp_phone_change");
        } else {
            console.log(`📱 Development OTP for phone change (${newPhoneNumber}): ${otp}`);
        }

        res.status(200).json({
            message: "OTP sent to new phone number",
            ...(process.env.NODE_ENV === 'development' && { otp })
        });
    } catch (error) {
        console.error('Phone change request error:', error);
        res.status(500).json({ message: "Failed to request phone change" });
    }
};

export const verifyPhoneChange = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { newPhoneNumber, otp } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!newPhoneNumber || !otp) {
            return res.status(400).json({ message: "Phone number and OTP are required" });
        }

        // Get current user
        const currentUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

        const isValid = await verifyOtpService(newPhoneNumber, otp);

        if (!isValid) {
            // Record failed attempt
            await db.insert(phoneChangeAttempts).values({
                userId,
                oldPhoneNumber: currentUser.phoneNumber,
                newPhoneNumber,
                status: 'failed',
            }).catch(err => console.error('Failed to record phone change attempt:', err));

            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.phoneNumber, newPhoneNumber))
            .limit(1);

        if (existingUser.length > 0 && existingUser[0].id !== userId) {
            return res.status(400).json({
                message: "This phone number is already registered with another account. Please use a different number or contact support if you believe this is an error."
            });
        }

        const [updatedUser] = await db
            .update(users)
            .set({ phoneNumber: newPhoneNumber })
            .where(eq(users.id, userId))
            .returning();

        // Record successful attempt
        await db.insert(phoneChangeAttempts).values({
            userId,
            oldPhoneNumber: currentUser.phoneNumber,
            newPhoneNumber,
            status: 'success',
        }).catch(err => console.error('Failed to record phone change attempt:', err));

        res.status(200).json({
            message: "Phone number updated successfully",
            user: {
                id: updatedUser.id,
                phoneNumber: updatedUser.phoneNumber,
                fullName: updatedUser.fullName,
                role: updatedUser.role,
                isOnboarded: updatedUser.isOnboarded,
            }
        });
    } catch (error) {
        console.error('Phone change verification error:', error);
        res.status(500).json({ message: "Failed to verify phone change" });
    }
};

export const registerDeviceToken = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { deviceToken } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!deviceToken || typeof deviceToken !== 'string') {
            return res.status(400).json({ message: "Valid device token is required" });
        }

        // Update user's device token
        const [updatedUser] = await db
            .update(users)
            .set({ deviceToken })
            .where(eq(users.id, userId))
            .returning();

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        console.log(`Device token registered for user ${userId}: ${deviceToken.substring(0, 20)}...`);

        res.status(200).json({
            message: "Device token registered successfully",
            success: true
        });
    } catch (error) {
        console.error('Device token registration error:', error);
        res.status(500).json({ message: "Failed to register device token" });
    }
};

export const requestAccountDeletion = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Get current user
        const currentUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

        // Send OTP to user's phone number
        const otp = await createOtp(currentUser.phoneNumber);
        if (process.env.NODE_ENV === 'production') {
            await sendSms(currentUser.phoneNumber, `SERVEX: Your OTP for account deletion is: ${otp}. If you did not request this, please ignore this message.`, "otp_account_deletion");
        } else {
            console.log(`📱 Development OTP for account deletion (${currentUser.phoneNumber}): ${otp}`);
        }

        res.status(200).json({
            message: "OTP sent to your phone number",
            phoneNumber: currentUser.phoneNumber.slice(-4).padStart(currentUser.phoneNumber.length, '*'),
        });
    } catch (error) {
        console.error('Account deletion request error:', error);
        res.status(500).json({ message: "Failed to request account deletion" });
    }
};

export const verifyAccountDeletion = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { otp } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!otp) {
            return res.status(400).json({ message: "OTP is required" });
        }
        const currentUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

        const isValid = await verifyOtpService(currentUser.phoneNumber, otp);

        if (!isValid) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));

        await db.delete(phoneChangeAttempts).where(eq(phoneChangeAttempts.userId, userId));

        await db.delete(users).where(eq(users.id, userId));

        console.log(`Account deleted for user ${userId}`);

        res.status(200).json({
            message: "Account deleted successfully"
        });
    } catch (error) {
        console.error('Account deletion verification error:', error);
        res.status(500).json({ message: "Failed to delete account" });
    }
};
