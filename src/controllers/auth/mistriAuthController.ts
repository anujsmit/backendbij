// backend/src/controllers/auth/mistriAuthController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../db";
import { 
    mistriAccounts,
    mistriProfiles, 
    refreshTokens, 
    loginAttempts,
    userAccounts,
    otps,
    users,
} from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createOtp, verifyOtp as verifyOtpService } from "../../services/otp";
import { sendSms } from "../../services/sms";
import { logger } from "../../utils/logger";
import { createAuditLog } from "../../services/auditLog";

const SALT_ROUNDS = 12;

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateTokens(mistriId: string, accountType: string) {
    const accessToken = jwt.sign(
        { userId: mistriId, type: "access", accountType },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
        { userId: mistriId, type: "refresh", accountType },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: "30d" }
    );

    return { accessToken, refreshToken };
}

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
}

// ============================================
// MISTRI REGISTRATION
// ============================================

export const registerMistri = async (req: Request, res: Response) => {
    try {
        const { phone, fullName, password, dob } = req.body;

        if (!phone || !fullName || !password) {
            return res.status(400).json({
                success: false,
                message: "Phone number, full name, and password are required"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        const cleanPhone = normalizePhone(phone);
        if (!/^9[6-8]\d{8}$/.test(cleanPhone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format"
            });
        }

        // ✅ Check if mistri already exists
        const existingMistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.phoneNumber, cleanPhone)
        });

        if (existingMistri) {
            return res.status(409).json({
                success: false,
                message: "Mistri with this phone number already exists"
            });
        }

        // ✅ Check if user already exists (cross-table check)
        const existingUser = await db.query.userAccounts.findFirst({
            where: eq(userAccounts.phoneNumber, cleanPhone)
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "This phone number is already registered as a customer"
            });
        }

        // ✅ Check if admin exists (cross-table check)
        const existingAdmin = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone)
        });

        if (existingAdmin) {
            return res.status(409).json({
                success: false,
                message: "This phone number is already registered as an admin"
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // ✅ Create mistri account
        const [newMistri] = await db.insert(mistriAccounts).values({
            phoneNumber: cleanPhone,
            fullName: fullName.trim(),
            passwordHash: hashedPassword,
            accountType: 'mistri',
            isActive: true,
            isVerified: false,
            dob: dob || null,
            isOnboarded: false,
        }).returning();

        // Generate OTP for verification
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000, 'mistri');
        
        if (process.env.NODE_ENV === 'production') {
            await sendSms(cleanPhone, `SERVEX: Your verification OTP is: ${otp}`, "otp_login");
        } else {
            console.log(`[DEV OTP] ${cleanPhone}: ${otp}`);
        }

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(newMistri.id, "mistri");

        // Store refresh token
        await db.insert(refreshTokens).values({
            token: refreshToken,
            userId: newMistri.id,
            accountType: 'mistri',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        // Create audit log
        await createAuditLog({
            entityType: "mistri_account",
            entityId: newMistri.id,
            action: "registration",
            performedBy: newMistri.id,
            performedByRole: "admin",
            newValue: { phone: cleanPhone, fullName: fullName.trim() },
        });

        return res.status(201).json({
            success: true,
            message: "Mistri registration successful. Please verify your phone number.",
            accessToken,
            refreshToken,
            user: {
                id: newMistri.id,
                phoneNumber: newMistri.phoneNumber,
                fullName: newMistri.fullName,
                accountType: newMistri.accountType,
                isVerified: false,
                isActive: true,
                isOnboarded: false,
                hasMistriProfile: false,
                dob: newMistri.dob,
            }
        });
    } catch (error) {
        logger.error("Mistri registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Registration failed. Please try again."
        });
    }
};

// ============================================
// MISTRI LOGIN
// ============================================

export const loginMistri = async (req: Request, res: Response) => {
    try {
        const { phone, password } = req.body;
        const ipAddress = req.ip || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Phone number and password are required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // Rate limiting
        const recentAttempts = await db
            .select({ count: sql<number>`count(*)` })
            .from(loginAttempts)
            .where(
                and(
                    eq(loginAttempts.phoneNumber, cleanPhone),
                    eq(loginAttempts.accountType, 'mistri'),
                    eq(loginAttempts.success, false),
                    sql`${loginAttempts.createdAt} > NOW() - INTERVAL '15 minutes'`
                )
            );

        if ((recentAttempts[0]?.count || 0) >= 5) {
            return res.status(429).json({
                success: false,
                message: "Too many failed attempts. Please try again later."
            });
        }

        // ✅ Find mistri account
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.phoneNumber, cleanPhone)
        });

        if (!mistri || !mistri.passwordHash) {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'mistri',
                attemptType: 'mistri_login',
                success: false,
                ipAddress,
                userAgent: userAgent || null,
            });
            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // ✅ Only allow mistri users
        if (mistri.accountType !== 'mistri') {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'mistri',
                attemptType: 'mistri_login',
                success: false,
                ipAddress,
                userAgent: userAgent || null,
            });
            return res.status(403).json({
                success: false,
                message: "Access denied. This login is for mistri users only."
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, mistri.passwordHash);
        if (!isValidPassword) {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'mistri',
                attemptType: 'mistri_login',
                success: false,
                ipAddress,
                userAgent: userAgent || null,
            });
            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // Check if account is active
        if (!mistri.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support."
            });
        }

        // Check if account has scheduled deletion
        const hasScheduledDeletion = mistri.deletionScheduledAt !== null && 
            new Date(mistri.deletionScheduledAt) > new Date();

        // Record successful login
        await db.insert(loginAttempts).values({
            phoneNumber: cleanPhone,
            accountType: 'mistri',
            attemptType: 'mistri_login',
            success: true,
            ipAddress,
            userAgent: userAgent || null,
        });

        // Update last login
        await db.update(mistriAccounts)
            .set({ lastLoginAt: new Date() })
            .where(eq(mistriAccounts.id, mistri.id));

        // ✅ Get mistri profile
        let approvalStatus = null;
        let hasMistriProfile = false;
        let approvalRejectionReason = null;
        
        const profile = await db.query.mistriProfiles.findFirst({
            where: eq(mistriProfiles.mistriId, mistri.id)
        });
        hasMistriProfile = !!profile;
        approvalStatus = profile?.approvalStatus || null;
        approvalRejectionReason = profile?.approvalRejectionReason || null;

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(mistri.id, "mistri");

        // Store refresh token
        await db.insert(refreshTokens).values({
            token: refreshToken,
            userId: mistri.id,
            accountType: 'mistri',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        // Create audit log
        await createAuditLog({
            entityType: "mistri_account",
            entityId: mistri.id,
            action: "login_success",
            performedBy: mistri.id,
            performedByRole: "admin",
            metadata: { ip: ipAddress }
        });

        // Build response
        const userResponse = {
            id: mistri.id,
            phoneNumber: mistri.phoneNumber,
            fullName: mistri.fullName,
            accountType: mistri.accountType,
            isVerified: mistri.isVerified || false,
            isActive: mistri.isActive,
            isOnboarded: mistri.isOnboarded || false,
            hasMistriProfile: hasMistriProfile,
            approvalStatus: approvalStatus,
            approvalRejectionReason: approvalRejectionReason,
            dob: mistri.dob,
            deletionScheduledAt: mistri.deletionScheduledAt,
            hasScheduledDeletion: hasScheduledDeletion,
        };

        logger.info(`✅ Mistri login successful: ${cleanPhone}`);

        return res.json({
            success: true,
            message: "Mistri login successful",
            accessToken,
            refreshToken,
            user: userResponse,
            requiresDeletionAction: hasScheduledDeletion,
        });
    } catch (error) {
        logger.error("Mistri login error:", error);
        return res.status(500).json({
            success: false,
            message: "Login failed. Please try again."
        });
    }
};

// ============================================
// MISTRI OTP VERIFICATION
// ============================================

export const verifyMistriOtp = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone and OTP are required"
            });
        }

        const cleanPhone = normalizePhone(phone);
        
        // ✅ Verify OTP
        await verifyOtpService(cleanPhone, otp, 'mistri');

        // ✅ Find mistri account
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.phoneNumber, cleanPhone)
        });

        if (!mistri) {
            return res.status(404).json({
                success: false,
                message: "Mistri account not found"
            });
        }

        // ✅ Only allow mistri users
        if (mistri.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Access denied. This endpoint is for mistri users only."
            });
        }

        // ✅ Update mistri as verified
        await db.update(mistriAccounts)
            .set({ isVerified: true })
            .where(eq(mistriAccounts.id, mistri.id));

        // ✅ Generate token
        const { accessToken } = generateTokens(mistri.id, "mistri");

        // ✅ Create audit log
        await createAuditLog({
            entityType: "mistri_account",
            entityId: mistri.id,
            action: "otp_verified",
            performedBy: mistri.id,
            performedByRole: "admin",
        });

        return res.json({
            success: true,
            message: "OTP verified successfully",
            accessToken,
            user: {
                id: mistri.id,
                phoneNumber: mistri.phoneNumber,
                fullName: mistri.fullName,
                accountType: mistri.accountType,
                isVerified: true,
                isActive: mistri.isActive,
                isOnboarded: mistri.isOnboarded,
                hasMistriProfile: false,
                dob: mistri.dob,
            }
        });
    } catch (error) {
        logger.error("Mistri OTP verification error:", error);
        return res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : "Invalid or expired OTP"
        });
    }
};

// ============================================
// MISTRI FORGOT PASSWORD
// ============================================

export const mistriForgotPassword = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // ✅ Check if mistri exists
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.phoneNumber, cleanPhone)
        });

        if (!mistri) {
            return res.status(404).json({
                success: false,
                message: "No account found with this phone number"
            });
        }

        if (mistri.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Access denied. Password reset is only for mistri users."
            });
        }

        // ✅ Generate OTP
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000, 'mistri');

        if (process.env.NODE_ENV === 'production') {
            await sendSms(cleanPhone, `SERVEX: Your password reset OTP is: ${otp}`, "otp_login");
        } else {
            logger.info(`[DEV OTP] ${cleanPhone}: ${otp}`);
        }

        return res.json({
            success: true,
            message: "OTP sent successfully"
        });
    } catch (error) {
        logger.error("Mistri forgot password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};

// ============================================
// MISTRI VERIFY FORGOT OTP
// ============================================

export const verifyMistriForgotOtp = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone and OTP are required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // ✅ Verify mistri exists
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.phoneNumber, cleanPhone)
        });

        if (!mistri || mistri.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only mistri users can reset passwords."
            });
        }

        // ✅ Verify OTP
        await verifyOtpService(cleanPhone, otp, 'mistri');

        // ✅ Generate reset token
        const resetToken = jwt.sign(
            { userId: mistri.id, type: 'reset', accountType: 'mistri' },
            process.env.JWT_SECRET!,
            { expiresIn: '15m' }
        );

        return res.json({
            success: true,
            message: "OTP verified successfully",
            token: resetToken
        });
    } catch (error) {
        logger.error("Verify mistri forgot OTP error:", error);
        return res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : "Invalid or expired OTP"
        });
    }
};

// ============================================
// MISTRI RESET PASSWORD
// ============================================

export const resetMistriPassword = async (req: Request, res: Response) => {
    try {
        const { phone, token, newPassword } = req.body;

        if (!phone || !token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Phone, token, and new password are required"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        // ✅ Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
            userId: string;
            type: string;
            accountType: string;
        };

        if (decoded.type !== 'reset' || decoded.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Invalid reset token"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // ✅ Verify mistri exists
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.phoneNumber, cleanPhone)
        });

        if (!mistri || mistri.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only mistri users can reset passwords."
            });
        }

        // ✅ Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // ✅ Update password
        await db.update(mistriAccounts)
            .set({ passwordHash: hashedPassword })
            .where(eq(mistriAccounts.id, mistri.id));

        // ✅ Invalidate all refresh tokens
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, mistri.id));

        // ✅ Create audit log
        await createAuditLog({
            entityType: "mistri_account",
            entityId: mistri.id,
            action: "password_reset",
            performedBy: mistri.id,
            performedByRole: "admin",
        });

        return res.json({
            success: true,
            message: "Password reset successfully"
        });
    } catch (error) {
        logger.error("Reset mistri password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to reset password"
        });
    }
};

// ============================================
// MISTRI LOGOUT
// ============================================

export const logoutMistri = async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body;

        if (refreshToken) {
            await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));
        }

        return res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        logger.error("Mistri logout error:", error);
        return res.status(500).json({
            success: false,
            message: "Logout failed"
        });
    }
};

// ============================================
// MISTRI REFRESH TOKEN
// ============================================

export const refreshMistriToken = async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: "Refresh token is required"
            });
        }

        // ✅ Verify refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as {
            userId: string;
            type: string;
            accountType: string;
        };

        if (decoded.type !== "refresh" || decoded.accountType !== "mistri") {
            return res.status(403).json({
                success: false,
                message: "Invalid refresh token"
            });
        }

        // ✅ Check if token exists in database
        const storedToken = await db.query.refreshTokens.findFirst({
            where: and(
                eq(refreshTokens.token, refreshToken),
                eq(refreshTokens.userId, decoded.userId)
            )
        });

        if (!storedToken) {
            return res.status(403).json({
                success: false,
                message: "Invalid refresh token"
            });
        }

        // ✅ Check if token is expired
        if (new Date(storedToken.expiresAt) < new Date()) {
            await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));
            return res.status(403).json({
                success: false,
                message: "Refresh token expired"
            });
        }

        // ✅ Generate new tokens
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId, "mistri");

        // ✅ Delete old refresh token
        await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));

        // ✅ Store new refresh token
        await db.insert(refreshTokens).values({
            token: newRefreshToken,
            userId: decoded.userId,
            accountType: 'mistri',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        return res.json({
            success: true,
            accessToken,
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        logger.error("Mistri refresh token error:", error);
        return res.status(403).json({
            success: false,
            message: "Invalid refresh token"
        });
    }
};

// ============================================
// GET MISTRI PROFILE (Protected)
// ============================================

export const getMistriProfile = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        // ✅ Find mistri account
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, userId)
        });

        if (!mistri) {
            return res.status(404).json({
                success: false,
                message: "Mistri account not found"
            });
        }

        if (mistri.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only mistri users can access this endpoint."
            });
        }

        // ✅ Get mistri profile
        let approvalStatus = null;
        let hasMistriProfile = false;
        let approvalRejectionReason = null;
        
        const profile = await db.query.mistriProfiles.findFirst({
            where: eq(mistriProfiles.mistriId, userId)
        });
        hasMistriProfile = !!profile;
        approvalStatus = profile?.approvalStatus || null;
        approvalRejectionReason = profile?.approvalRejectionReason || null;

        return res.json({
            success: true,
            user: {
                id: mistri.id,
                phoneNumber: mistri.phoneNumber,
                fullName: mistri.fullName,
                accountType: mistri.accountType,
                isVerified: mistri.isVerified,
                isActive: mistri.isActive,
                isOnboarded: mistri.isOnboarded,
                hasMistriProfile: hasMistriProfile,
                approvalStatus: approvalStatus,
                approvalRejectionReason: approvalRejectionReason,
                dob: mistri.dob,
                createdAt: mistri.createdAt,
                lastLoginAt: mistri.lastLoginAt,
            }
        });
    } catch (error) {
        logger.error("Get mistri profile error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get profile"
        });
    }
};

// ============================================
// MISTRI CHANGE PASSWORD (Protected)
// ============================================

export const changeMistriPassword = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { currentPassword, newPassword } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Current password and new password are required"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 6 characters"
            });
        }

        // ✅ Find mistri account
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, userId)
        });

        if (!mistri || !mistri.passwordHash) {
            return res.status(404).json({
                success: false,
                message: "Mistri account not found"
            });
        }

        // ✅ Verify current password
        const isValid = await bcrypt.compare(currentPassword, mistri.passwordHash);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        // ✅ Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await db.update(mistriAccounts)
            .set({ passwordHash: hashedPassword })
            .where(eq(mistriAccounts.id, userId));

        // ✅ Create audit log
        await createAuditLog({
            entityType: "mistri_account",
            entityId: userId,
            action: "password_changed",
            performedBy: userId,
            performedByRole: "admin",
        });

        return res.json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        logger.error("Change mistri password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to change password"
        });
    }
};