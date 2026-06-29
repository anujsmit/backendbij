// backend/src/controllers/auth/adminAuthController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../db";
import { users, refreshTokens, loginAttempts, employeeProfiles } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { createAuditLog } from "../../services/auditLog";

const SALT_ROUNDS = 12;

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateTokens(userId: string, accountType: string) {
    const accessToken = jwt.sign(
        { userId, type: "access", accountType },
        process.env.JWT_SECRET!,
        { expiresIn: "24h" }
    );

    const refreshToken = jwt.sign(
        { userId, type: "refresh", accountType },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: "30d" }
    );

    return { accessToken, refreshToken };
}

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
}

// ============================================
// ADMIN LOGIN (Password Only)
// ============================================

export const adminLogin = async (req: Request, res: Response) => {
    try {
        const { phone, password } = req.body;
        const ipAddress = req.ip || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        // ✅ Validate input
        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Phone number and password are required"
            });
        }

        const cleanPhone = normalizePhone(phone);

        // ✅ Check for too many failed attempts (rate limiting)
        const recentAttempts = await db
            .select({ count: sql<number>`count(*)` })
            .from(loginAttempts)
            .where(
                and(
                    eq(loginAttempts.phoneNumber, cleanPhone),
                    eq(loginAttempts.accountType, 'admin'),
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

        // ✅ Find admin user in unified users table
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phoneNumber, cleanPhone),
                eq(users.accountType, 'admin')  // ✅ Changed from role to accountType
            ),
        });

        // ✅ Check if user exists and is admin
        if (!user) {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'admin',
                attemptType: "admin_login",
                success: false,
                ipAddress,
                userAgent: userAgent || null,
            });

            await createAuditLog({
                entityType: "user",
                entityId: cleanPhone,
                action: "admin_login_failed",
                performedBy: cleanPhone,
                performedByRole: "admin",
                metadata: { reason: "Invalid credentials or not admin", ip: ipAddress }
            });

            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // ✅ Check if account is active
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support."
            });
        }

        // ✅ Check if password exists
        if (!user.passwordHash) {
            return res.status(403).json({
                success: false,
                message: "Password not set. Please contact support."
            });
        }

        // ✅ Verify password
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                accountType: 'admin',
                attemptType: "admin_login",
                success: false,
                ipAddress,
                userAgent: userAgent || null,
            });

            await createAuditLog({
                entityType: "user",
                entityId: user.id,
                action: "admin_login_failed",
                performedBy: user.id,
                performedByRole: "admin",
                metadata: { reason: "Invalid password", ip: ipAddress }
            });

            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // ✅ Record successful login
        await db.insert(loginAttempts).values({
            phoneNumber: cleanPhone,
            accountType: 'admin',
            attemptType: "admin_login",
            success: true,
            ipAddress,
            userAgent: userAgent || null,
        });

        // ✅ Update last login
        await db.update(users)
            .set({ lastLoginAt: new Date() })
            .where(eq(users.id, user.id));

        // ✅ Generate tokens
        const { accessToken, refreshToken } = generateTokens(user.id, "admin");

        // ✅ Store refresh token
        await db.insert(refreshTokens).values({
            token: refreshToken,
            userId: user.id,
            accountType: 'admin',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        // ✅ Get employee profile for permissions (optional)
        let employeeProfile = null;
        try {
            employeeProfile = await db.query.employeeProfiles.findFirst({
                where: eq(employeeProfiles.userId, user.id)
            });
        } catch (error) {
            // Employee profiles table might not exist yet
        }

        // ✅ Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: user.id,
            action: "admin_login_success",
            performedBy: user.id,
            performedByRole: "admin",
            metadata: { ip: ipAddress }
        });

        // ✅ Build response
        return res.status(200).json({
            success: true,
            message: "Admin login successful",
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                fullName: user.fullName,
                phoneNumber: user.phoneNumber,
                accountType: user.accountType,  // ✅ Changed from role to accountType
                isActive: user.isActive,
                staffRole: employeeProfile?.staffRole || "super_admin",
                permissions: employeeProfile?.permissions || ["*"],
                designation: employeeProfile?.designation || null,
                avatarUrl: user.avatarUrl || null,
                createdAt: user.createdAt,
                lastLoginAt: user.lastLoginAt,
            }
        });
    } catch (error) {
        logger.error("Admin login error:", error);
        return res.status(500).json({
            success: false,
            message: "Login failed. Please try again."
        });
    }
};

// ============================================
// ADMIN LOGOUT
// ============================================

export const adminLogout = async (req: Request, res: Response) => {
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
        logger.error("Admin logout error:", error);
        return res.status(500).json({
            success: false,
            message: "Logout failed"
        });
    }
};

// ============================================
// ADMIN REFRESH TOKEN
// ============================================

export const adminRefreshToken = async (req: Request, res: Response) => {
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

        if (decoded.type !== "refresh" || decoded.accountType !== "admin") {
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
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId, "admin");

        // ✅ Delete old refresh token
        await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));

        // ✅ Store new refresh token
        await db.insert(refreshTokens).values({
            token: newRefreshToken,
            userId: decoded.userId,
            accountType: 'admin',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        return res.json({
            success: true,
            accessToken,
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        logger.error("Admin refresh token error:", error);
        return res.status(403).json({
            success: false,
            message: "Invalid refresh token"
        });
    }
};

// ============================================
// ADMIN GET CURRENT USER (Profile)
// ============================================

export const adminGetMe = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const user = await db.query.users.findFirst({
            where: and(
                eq(users.id, userId),
                eq(users.accountType, 'admin')  // ✅ Changed from role to accountType
            )
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Admin user not found"
            });
        }

        // ✅ Get employee profile for permissions
        let employeeProfile = null;
        try {
            employeeProfile = await db.query.employeeProfiles.findFirst({
                where: eq(employeeProfiles.userId, user.id)
            });
        } catch (error) {
            // Employee profiles table might not exist yet
        }

        return res.json({
            success: true,
            user: {
                id: user.id,
                fullName: user.fullName,
                phoneNumber: user.phoneNumber,
                accountType: user.accountType,  // ✅ Changed from role to accountType
                isActive: user.isActive,
                staffRole: employeeProfile?.staffRole || "super_admin",
                permissions: employeeProfile?.permissions || ["*"],
                designation: employeeProfile?.designation || null,
                avatarUrl: user.avatarUrl || null,
                createdAt: user.createdAt,
                lastLoginAt: user.lastLoginAt,
            }
        });
    } catch (error) {
        logger.error("Admin get me error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get admin profile"
        });
    }
};

// ============================================
// ADMIN CHANGE PASSWORD
// ============================================

export const adminChangePassword = async (req: Request, res: Response) => {
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

        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user || !user.passwordHash) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // ✅ Verify current password
        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        // ✅ Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await db.update(users)
            .set({ passwordHash: hashedPassword })
            .where(eq(users.id, userId));

        // ✅ Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: userId,
            action: "admin_password_changed",
            performedBy: userId,
            performedByRole: "admin",
        });

        return res.json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        logger.error("Admin change password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to change password"
        });
    }
};

// ============================================
// ADMIN REGISTER (For creating new admin users)
// ============================================

export const adminRegister = async (req: Request, res: Response) => {
    try {
        const { phone, fullName, password, staffRole, permissions, designation } = req.body;
        const performerId = (req as any).user?.userId;

        // ✅ Validate input
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

        // ✅ Check if user already exists
        const existingUser = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone)
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "User with this phone number already exists"
            });
        }

        // ✅ Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // ✅ Create admin user in unified users table
        const [newAdmin] = await db.insert(users).values({
            phoneNumber: cleanPhone,
            fullName: fullName.trim(),
            passwordHash: hashedPassword,
            accountType: 'admin',  // ✅ Set as admin
            isActive: true,
            isVerified: true,
            isOnboarded: true,
        }).returning();

        // ✅ Create employee profile
        if (newAdmin) {
            try {
                await db.insert(employeeProfiles).values({
                    userId: newAdmin.id,
                    staffRole: staffRole || "support",
                    permissions: permissions || ["*"],
                    designation: designation || null,
                    createdBy: performerId || newAdmin.id,
                });
            } catch (error) {
                logger.error("Failed to create employee profile:", error);
                // Don't fail the registration if employee profile creation fails
            }
        }

        // ✅ Create audit log
        await createAuditLog({
            entityType: "user",
            entityId: newAdmin.id,
            action: "admin_registration",
            performedBy: performerId || newAdmin.id,
            performedByRole: "admin",
            newValue: { phone: cleanPhone, fullName: fullName.trim(), staffRole },
        });

        return res.status(201).json({
            success: true,
            message: "Admin user created successfully",
            user: {
                id: newAdmin.id,
                fullName: newAdmin.fullName,
                phoneNumber: newAdmin.phoneNumber,
                accountType: newAdmin.accountType,
                isActive: newAdmin.isActive,
                staffRole: staffRole || "support",
                permissions: permissions || ["*"],
                designation: designation || null,
            }
        });
    } catch (error) {
        logger.error("Admin registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create admin user"
        });
    }
};