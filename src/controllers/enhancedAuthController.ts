import { Request, Response, NextFunction } from "express";
import { createOtp, verifyOtp as verifyOtpService } from "../services/otp";
import { sendSms } from "../services/sms";
import { db } from "../db";
import { users, refreshTokens, phoneChangeAttempts, mistriProfiles } from "../db/schema";
import { eq, and, gt, gte, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { logger } from "../utils/logger";
import { createAuditLog } from "../services/auditLog";

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

// ✅ FIXED: Added null check for user.role
export const cancelAccountDeletion = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        // Get user to check if deletion is scheduled
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (!user.deletionScheduledAt) {
            return res.status(400).json({
                success: false,
                message: "No deletion scheduled"
            });
        }

        // Clear deletion_scheduled_at and reactivate account
        const [updatedUser] = await db.update(users)
            .set({
                deletionScheduledAt: null,
                isActive: true,
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId))
            .returning();

        // ✅ FIXED: Provide default role if user.role is null
        const userRole = (user.role || 'user') as 'user' | 'mistri' | 'admin';

        // Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: userId,
            action: "account_deletion_cancelled",
            performedBy: userId,
            performedByRole: userRole,
            oldValue: { deletionScheduledAt: user.deletionScheduledAt },
            newValue: { deletionScheduledAt: null },
        });

        return res.json({
            success: true,
            message: "Account deletion cancelled successfully",
            user: {
                id: updatedUser.id,
                phoneNumber: updatedUser.phoneNumber,
                fullName: updatedUser.fullName,
                role: updatedUser.role,
                deletionScheduledAt: null,
            }
        });
    } catch (error) {
        console.error("Error cancelling account deletion:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel account deletion"
        });
    }
};

// ✅ FIXED: Added scheduleAccountDeletion function
export const scheduleAccountDeletion = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
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

        // Get user with password hash
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user || !user.passwordHash) {
            return res.status(404).json({
                success: false,
                message: "User not found or password not set"
            });
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: "Incorrect password",
                attemptsRemaining: 9
            });
        }

        // Check if user already has a scheduled deletion
        if (user.deletionScheduledAt && new Date(user.deletionScheduledAt) > new Date()) {
            return res.status(400).json({
                success: false,
                message: "Account deletion already scheduled"
            });
        }

        // Schedule deletion (7 days from now)
        const deletionDate = new Date();
        deletionDate.setDate(deletionDate.getDate() + 7);

        const [updatedUser] = await db.update(users)
            .set({
                deletionScheduledAt: deletionDate,
                isActive: false,
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId))
            .returning();

        // ✅ FIXED: Provide default role if user.role is null
        const userRole = (user.role || 'user') as 'user' | 'mistri' | 'admin';

        await createAuditLog({
            entityType: "user",
            entityId: userId,
            action: "account_deletion_scheduled",
            performedBy: userId,
            performedByRole: userRole,
            oldValue: { deletionScheduledAt: null, isActive: true },
            newValue: { 
                deletionScheduledAt: deletionDate.toISOString(), 
                isActive: false 
            },
            metadata: { scheduledDate: deletionDate.toISOString() }
        });

        return res.json({
            success: true,
            message: "Account deletion scheduled",
            deletionScheduledAt: deletionDate.toISOString(),
            user: {
                id: updatedUser.id,
                phoneNumber: updatedUser.phoneNumber,
                fullName: updatedUser.fullName,
                deletionScheduledAt: updatedUser.deletionScheduledAt,
            }
        });
    } catch (error) {
        logger.error("Error scheduling account deletion:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to schedule account deletion"
        });
    }
};

// ✅ FIXED: Added getDeletionStatus function
export const getDeletionStatus = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const hasScheduledDeletion = user.deletionScheduledAt !== null && 
            new Date(user.deletionScheduledAt) > new Date();

        return res.json({
            success: true,
            deletionScheduledAt: hasScheduledDeletion ? user.deletionScheduledAt : null,
            isActive: user.isActive,
            hasScheduledDeletion,
        });
    } catch (error) {
        console.error("Error getting deletion status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get deletion status"
        });
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone and OTP are required"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        
        // Verify OTP
        await verifyOtpService(cleanPhone, otp);

        // Find or create user
        let user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone)
        });

        if (!user) {
            // Create new user
            const [newUser] = await db.insert(users).values({
                phoneNumber: cleanPhone,
                fullName: 'User',
                role: 'user',
                isActive: true,
                isVerified: true,
            }).returning();
            user = newUser;
        } else {
            // Update last login only - DO NOT touch deletion_scheduled_at
            await db.update(users)
                .set({ 
                    lastLoginAt: new Date(),
                })
                .where(eq(users.id, user.id));
        }

        // Check if account has a scheduled deletion
        const hasScheduledDeletion = user.deletionScheduledAt !== null && 
            new Date(user.deletionScheduledAt) > new Date();

        // Generate token
        const accessToken = jwt.sign(
            { userId: user.id, type: 'access' },
            process.env.JWT_SECRET!,
            { expiresIn: '7d' }
        );

        // If user has scheduled deletion, return special status
        if (hasScheduledDeletion) {
            return res.status(200).json({
                success: true,
                message: "Login successful",
                accessToken,
                user: {
                    id: user.id,
                    phoneNumber: user.phoneNumber,
                    fullName: user.fullName,
                    role: user.role,
                    isVerified: user.isVerified,
                    isOnboarded: user.isOnboarded,
                    deletionScheduledAt: user.deletionScheduledAt,
                    hasScheduledDeletion: true,
                },
                requiresDeletionAction: true,
                deletionScheduledAt: user.deletionScheduledAt,
            });
        }

        return res.json({
            success: true,
            message: "Login successful",
            accessToken,
            user: {
                id: user.id,
                phoneNumber: user.phoneNumber,
                fullName: user.fullName,
                role: user.role,
                isVerified: user.isVerified,
                isOnboarded: user.isOnboarded,
                deletionScheduledAt: null,
                hasScheduledDeletion: false,
            },
            requiresDeletionAction: false,
        });
    } catch (error) {
        logger.error("OTP verification error:", error);
        return res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : "Invalid or expired OTP"
        });
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

        const currentUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

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

        const currentUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

        const isValid = await verifyOtpService(newPhoneNumber, otp);

        if (!isValid) {
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

        const currentUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

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

// ============================================
// FORGOT PASSWORD - RESET PASSWORD FLOW
// ============================================

// Step 1: Send OTP for password reset
export const forgotPassword = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = phone.replace(/\s+/g, '');

        // Check if user exists
        const user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone),
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "No account found with this phone number"
            });
        }

        // Generate OTP
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000); // 10 minutes expiry

        // Send SMS
        if (process.env.NODE_ENV === 'production') {
            await sendSms(cleanPhone, `SERVEX: Your password reset OTP is: ${otp}. Valid for 10 minutes.`, "otp_reset");
        } else {
            console.log(`📱 Development OTP for password reset (${cleanPhone}): ${otp}`);
        }

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully"
        });
    } catch (error) {
        console.error("Forgot password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};

// Step 2: Verify OTP and return reset token
export const verifyForgotOtp = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone number and OTP are required"
            });
        }

        const cleanPhone = phone.replace(/\s+/g, '');

        // Verify OTP
        await verifyOtpService(cleanPhone, otp);

        // Generate a temporary reset token (JWT with short expiry - 15 minutes)
        const resetToken = jwt.sign(
            { 
                phone: cleanPhone, 
                type: 'password_reset',
                purpose: 'reset_password'
            },
            process.env.JWT_SECRET!,
            { expiresIn: '15m' }
        );

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully",
            token: resetToken
        });
    } catch (error) {
        console.error("Verify forgot OTP error:", error);
        return res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : "Invalid or expired OTP"
        });
    }
};

// Step 3: Reset password using the token
export const resetPassword = async (req: Request, res: Response) => {
    try {
        const { phone, token, newPassword } = req.body;

        if (!phone || !token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Phone number, token, and new password are required"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        // Verify the reset token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
                phone: string;
                type: string;
                purpose: string;
            };
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired reset token"
            });
        }

        // Check if token is for password reset
        if (decoded.type !== 'password_reset' || decoded.purpose !== 'reset_password') {
            return res.status(401).json({
                success: false,
                message: "Invalid token type"
            });
        }

        // Verify phone matches
        const cleanPhone = phone.replace(/\s+/g, '');
        if (decoded.phone !== cleanPhone) {
            return res.status(401).json({
                success: false,
                message: "Token does not match this phone number"
            });
        }

        // Check if user exists
        const user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone),
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Update password
        await db.update(users)
            .set({ 
                passwordHash: hashedPassword,
                updatedAt: new Date()
            })
            .where(eq(users.id, user.id));

        // Optional: Invalidate all existing refresh tokens for this user
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));

        return res.status(200).json({
            success: true,
            message: "Password reset successfully"
        });
    } catch (error) {
        console.error("Reset password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to reset password"
        });
    }
};