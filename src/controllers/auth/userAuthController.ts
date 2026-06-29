// backend/src/controllers/auth/userAuthController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../db";
import { 
    users,
    loginAttempts, 
    refreshTokens,
} from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createOtp, verifyOtp as verifyOtpService, resendOtp } from "../../services/otp";
import { sendSms } from "../../services/sms";
import { logger } from "../../utils/logger";
import { createAuditLog } from "../../services/auditLog";

const SALT_ROUNDS = 12;

// ============================================
// ✅ FIX: Ensure JWT secrets are defined
// ============================================
if (!process.env.JWT_SECRET) {
    console.warn('⚠️ JWT_SECRET not found in environment. Using development fallback.');
    process.env.JWT_SECRET = 'servexisaserviceproviderin2026';
}

if (!process.env.JWT_REFRESH_SECRET) {
    console.warn('⚠️ JWT_REFRESH_SECRET not found in environment. Using development fallback.');
    process.env.JWT_REFRESH_SECRET = 'servexisaserviceproviderin2026_refresh';
}

console.log('🔑 JWT_SECRET is', process.env.JWT_SECRET ? '✅ SET' : '❌ MISSING');
console.log('🔑 JWT_REFRESH_SECRET is', process.env.JWT_REFRESH_SECRET ? '✅ SET' : '❌ MISSING');

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateTokens(userId: string, accountType: string) {
    const secret = process.env.JWT_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    
    if (!secret || !refreshSecret) {
        console.error('❌ JWT secrets are missing!');
        throw new Error('JWT secrets are not configured. Please check your environment variables.');
    }
    
    const accessToken = jwt.sign(
        { userId, type: "access", accountType },
        secret,
        { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
        { userId, type: "refresh", accountType },
        refreshSecret,
        { expiresIn: "30d" }
    );

    return { accessToken, refreshToken };
}

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
}

// ============================================
// USER REGISTRATION
// ============================================

export const registerUser = async (req: Request, res: Response) => {
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
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format"
            });
        }

        // Check if user already exists in unified users table
        const existingUser = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone)
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "User with this phone number already exists"
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert into unified users table
        const [newUser] = await db.insert(users).values({
            phoneNumber: cleanPhone,
            fullName: fullName.trim(),
            passwordHash: hashedPassword,
            accountType: 'user',
            isActive: true,
            isVerified: false,
            isOnboarded: false,
            dob: dob || null,
        }).returning();

        // Generate OTP
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000, 'user');
        
        if (process.env.NODE_ENV === 'production') {
            await sendSms(cleanPhone, `SERVEX: Your verification OTP is: ${otp}`, "otp_login");
        } else {
            console.log(`[DEV OTP] ${cleanPhone}: ${otp}`);
        }

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(newUser.id, "user");

        // Store refresh token
        await db.insert(refreshTokens).values({
            token: refreshToken,
            userId: newUser.id,
            accountType: 'user',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        // Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: newUser.id,
            action: "registration",
            performedBy: newUser.id,
            performedByRole: "admin",
            newValue: { phone: cleanPhone, fullName: fullName.trim() },
        });

        return res.status(201).json({
            success: true,
            message: "User registration successful. Please verify your phone number.",
            accessToken,
            refreshToken,
            user: {
                id: newUser.id,
                phoneNumber: newUser.phoneNumber,
                fullName: newUser.fullName,
                accountType: newUser.accountType,
                isVerified: false,
                isActive: true,
                isOnboarded: false,
                dob: newUser.dob,
            }
        });
    } catch (error) {
        logger.error("User registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Registration failed. Please try again."
        });
    }
};
// ============================================
// USER LOGIN (ONLY FOR USER/CUSTOMER)
// ============================================

export const loginUser = async (req: Request, res: Response) => {
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
                    eq(loginAttempts.accountType, 'user'),
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

        // Find user in unified users table
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'user')  // Only user accounts
            )
        });

        if (!user || !user.passwordHash) {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'user',
                attemptType: 'user_login',
                success: false,
                ipAddress,
                userAgent: userAgent || null,
            });
            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'user',
                attemptType: 'user_login',
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
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support."
            });
        }

        // ✅ NEW: Check if user is verified - send OTP if not verified
        if (!user.isVerified) {
            // Generate and send OTP
            const otp = await createOtp(cleanPhone, 10 * 60 * 1000, 'user');
            
            if (process.env.NODE_ENV === 'production') {
                await sendSms(cleanPhone, `SERVEX: Your verification OTP is: ${otp}`, "otp_login");
            } else {
                console.log(`[DEV OTP] ${cleanPhone}: ${otp}`);
            }

            // Record the login attempt with verification required flag
            // ✅ REMOVED: 'metadata' field that doesn't exist in schema
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'user',
                attemptType: 'user_login',
                success: true, // Password was correct
                ipAddress,
                userAgent: userAgent || null,
            });

            // Return response indicating verification is required
            return res.status(403).json({
                success: false,
                message: "Please verify your phone number first",
                isVerified: false,
                requiresVerification: true,
                phone: cleanPhone,
                user: {
                    id: user.id,
                    phoneNumber: user.phoneNumber,
                    fullName: user.fullName,
                    accountType: user.accountType,
                    isVerified: false,
                    isActive: user.isActive,
                    isOnboarded: user.isOnboarded || false,
                }
            });
        }

        // Check if account has scheduled deletion
        const hasScheduledDeletion = user.deletionScheduledAt !== null && 
            new Date(user.deletionScheduledAt) > new Date();

        // Record successful login
        await db.insert(loginAttempts).values({
            phoneNumber: cleanPhone,
            accountType: 'user',
            attemptType: 'user_login',
            success: true,
            ipAddress,
            userAgent: userAgent || null,
        });

        // Update last login
        await db.update(users)
            .set({ lastLoginAt: new Date() })
            .where(eq(users.id, user.id));

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user.id, "user");

        // Store refresh token
        await db.insert(refreshTokens).values({
            token: refreshToken,
            userId: user.id,
            accountType: 'user',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        // Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: user.id,
            action: "login_success",
            performedBy: user.id,
            performedByRole: "admin",
            metadata: { ip: ipAddress }
        });

        // Build response
        const userResponse = {
            id: user.id,
            phoneNumber: user.phoneNumber,
            fullName: user.fullName,
            accountType: user.accountType,
            isVerified: user.isVerified || false,
            isActive: user.isActive,
            isOnboarded: user.isOnboarded || false,
            dob: user.dob,
            deletionScheduledAt: user.deletionScheduledAt,
            hasScheduledDeletion: hasScheduledDeletion,
            email: user.email,
            avatarUrl: user.avatarUrl,
            defaultLocation: user.defaultLocation,
            preferences: user.preferences,
        };

        logger.info(`✅ User login successful: ${cleanPhone}`);

        return res.json({
            success: true,
            message: "User login successful",
            accessToken,
            refreshToken,
            user: userResponse,
            requiresDeletionAction: hasScheduledDeletion,
        });
    } catch (error) {
        logger.error("User login error:", error);
        return res.status(500).json({
            success: false,
            message: "Login failed. Please try again."
        });
    }
};
// backend/src/controllers/auth/userAuthController.ts

// ============================================
// USER RESEND VERIFICATION OTP (During Login)
// ============================================

export const resendVerificationOtp = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // Check if user exists
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'user')
            )
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Check if user is already verified
        if (user.isVerified) {
            return res.status(400).json({
                success: false,
                message: "User is already verified"
            });
        }

        // Generate and send OTP
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000, 'user');

        if (process.env.NODE_ENV === 'production') {
            await sendSms(cleanPhone, `SERVEX: Your verification OTP is: ${otp}`, "otp_login");
        } else {
            logger.info(`[DEV OTP] ${cleanPhone}: ${otp}`);
        }

        return res.json({
            success: true,
            message: "Verification OTP sent successfully",
            phone: cleanPhone,
        });
    } catch (error) {
        logger.error("Resend verification OTP error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};
// ============================================
// USER OTP VERIFICATION
// ============================================

export const verifyUserOtp = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone and OTP are required"
            });
        }

        const cleanPhone = normalizePhone(phone);
        
        // Verify OTP
        await verifyOtpService(cleanPhone, otp, 'user');

        // Find user in unified users table
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'user')
            )
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Update user as verified
        await db.update(users)
            .set({ isVerified: true })
            .where(eq(users.id, user.id));

        // Generate token
        const { accessToken } = generateTokens(user.id, "user");

        // Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: user.id,
            action: "otp_verified",
            performedBy: user.id,
            performedByRole: "admin",
        });

        return res.json({
            success: true,
            message: "OTP verified successfully",
            accessToken,
            user: {
                id: user.id,
                phoneNumber: user.phoneNumber,
                fullName: user.fullName,
                accountType: user.accountType,
                isVerified: true,
                isActive: user.isActive,
                isOnboarded: user.isOnboarded,
                dob: user.dob,
            }
        });
    } catch (error) {
        logger.error("User OTP verification error:", error);
        return res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : "Invalid or expired OTP"
        });
    }
};

// ============================================
// USER RESEND OTP
// ============================================

export const resendUserOtp = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // Check if user exists
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'user')
            )
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Resend OTP
        const otp = await resendOtp(cleanPhone, 10 * 60 * 1000, 'user');

        if (process.env.NODE_ENV === 'production') {
            await sendSms(cleanPhone, `SERVEX: Your verification OTP is: ${otp}`, "otp_login");
        } else {
            logger.info(`[DEV OTP] ${cleanPhone}: ${otp}`);
        }

        return res.json({
            success: true,
            message: "OTP sent successfully"
        });
    } catch (error) {
        logger.error("Resend user OTP error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};

// ============================================
// USER FORGOT PASSWORD
// ============================================

export const userForgotPassword = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // Check if user exists
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'user')
            )
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "No account found with this phone number"
            });
        }

        // Generate OTP
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000, 'user');

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
        logger.error("User forgot password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};

// ============================================
// USER VERIFY FORGOT OTP
// ============================================

export const verifyUserForgotOtp = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone and OTP are required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // Verify user exists
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'user')
            )
        });

        if (!user) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only users can reset passwords."
            });
        }

        // Verify OTP
        await verifyOtpService(cleanPhone, otp, 'user');

        // Generate reset token
        const resetToken = jwt.sign(
            { userId: user.id, type: 'reset', accountType: 'user' },
            process.env.JWT_SECRET!,
            { expiresIn: '15m' }
        );

        return res.json({
            success: true,
            message: "OTP verified successfully",
            token: resetToken
        });
    } catch (error) {
        logger.error("Verify user forgot OTP error:", error);
        return res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : "Invalid or expired OTP"
        });
    }
};

// ============================================
// USER RESET PASSWORD
// ============================================

export const resetUserPassword = async (req: Request, res: Response) => {
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

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
            userId: string;
            type: string;
            accountType: string;
        };

        if (decoded.type !== 'reset' || decoded.accountType !== 'user') {
            return res.status(403).json({
                success: false,
                message: "Invalid reset token"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // Verify user exists
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'user')
            )
        });

        if (!user) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only users can reset passwords."
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Update password
        await db.update(users)
            .set({ passwordHash: hashedPassword })
            .where(eq(users.id, user.id));

        // Invalidate all refresh tokens
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));

        // Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: user.id,
            action: "password_reset",
            performedBy: user.id,
            performedByRole: "admin",
        });

        return res.json({
            success: true,
            message: "Password reset successfully"
        });
    } catch (error) {
        logger.error("Reset user password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to reset password"
        });
    }
};

// ============================================
// USER LOGOUT
// ============================================

export const logoutUser = async (req: Request, res: Response) => {
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
        logger.error("User logout error:", error);
        return res.status(500).json({
            success: false,
            message: "Logout failed"
        });
    }
};

// ============================================
// USER REFRESH TOKEN
// ============================================

export const refreshUserToken = async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: "Refresh token is required"
            });
        }

        // Verify refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as {
            userId: string;
            type: string;
            accountType: string;
        };

        if (decoded.type !== "refresh" || decoded.accountType !== "user") {
            return res.status(403).json({
                success: false,
                message: "Invalid refresh token"
            });
        }

        // Check if token exists in database
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

        // Check if token is expired
        if (new Date(storedToken.expiresAt) < new Date()) {
            await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));
            return res.status(403).json({
                success: false,
                message: "Refresh token expired"
            });
        }

        // Generate new tokens
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId, "user");

        // Delete old refresh token
        await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));

        // Store new refresh token
        await db.insert(refreshTokens).values({
            token: newRefreshToken,
            userId: decoded.userId,
            accountType: 'user',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        return res.json({
            success: true,
            accessToken,
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        logger.error("User refresh token error:", error);
        return res.status(403).json({
            success: false,
            message: "Invalid refresh token"
        });
    }
};

// ============================================
// GET USER PROFILE (Protected)
// ============================================

export const getUserProfile = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        // Find user in unified users table
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (user.accountType !== 'user') {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only users can access this endpoint."
            });
        }

        return res.json({
            success: true,
            user: {
                id: user.id,
                phoneNumber: user.phoneNumber,
                fullName: user.fullName,
                accountType: user.accountType,
                isVerified: user.isVerified,
                isActive: user.isActive,
                isOnboarded: user.isOnboarded,
                dob: user.dob,
                createdAt: user.createdAt,
                lastLoginAt: user.lastLoginAt,
                defaultLocation: user.defaultLocation,
                avatarUrl: user.avatarUrl,
                email: user.email,
                preferences: user.preferences,
            }
        });
    } catch (error) {
        logger.error("Get user profile error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get user profile"
        });
    }
};

// ============================================
// USER CHANGE PASSWORD (Protected)
// ============================================

export const changeUserPassword = async (req: Request, res: Response) => {
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

        // Find user in unified users table
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user || !user.passwordHash) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await db.update(users)
            .set({ passwordHash: hashedPassword })
            .where(eq(users.id, userId));

        // Create audit log
        await createAuditLog({
            entityType: "user",
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
        logger.error("Change user password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to change password"
        });
    }
};
// ============================================
// UPDATE USER PROFILE (Protected)
// ============================================

export const updateUserProfile = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { fullName, email, defaultLocation, preferences, isOnboarded, avatarUrl } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        // Find user in unified users table
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Build update data
        const updateData: any = { updatedAt: new Date() };
        if (fullName !== undefined) updateData.fullName = fullName.trim();
        if (email !== undefined) updateData.email = email.trim();
        if (defaultLocation !== undefined) updateData.defaultLocation = defaultLocation;
        if (preferences !== undefined) updateData.preferences = preferences;
        if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
        if (isOnboarded !== undefined) updateData.isOnboarded = isOnboarded; // ✅ Add this

        // Update user
        const [updatedUser] = await db.update(users)
            .set(updateData)
            .where(eq(users.id, userId))
            .returning();

        return res.json({
            success: true,
            message: "Profile updated successfully",
            user: {
                id: updatedUser.id,
                phoneNumber: updatedUser.phoneNumber,
                fullName: updatedUser.fullName,
                accountType: updatedUser.accountType,
                isVerified: updatedUser.isVerified,
                isActive: updatedUser.isActive,
                isOnboarded: updatedUser.isOnboarded, // ✅ Return this
                dob: updatedUser.dob,
                email: updatedUser.email,
                defaultLocation: updatedUser.defaultLocation,
                preferences: updatedUser.preferences,
                avatarUrl: updatedUser.avatarUrl,
            }
        });
    } catch (error) {
        logger.error("Update user profile error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update profile"
        });
    }
};