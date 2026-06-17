import { Request, Response } from "express";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createAuditLog } from "../services/auditLog";
import { createOtp } from "../services/otp";
import { sendSms } from "../services/sms";
import { logger } from "../utils/logger";

const ADMIN_TOKEN_COOKIE = "admin_token";

function getAdminCookieDomain(): string | undefined {
    return process.env.ADMIN_COOKIE_DOMAIN?.trim() || undefined;
}

function isHttpsRequest(req: Request): boolean {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const proto = Array.isArray(forwardedProto)
        ? forwardedProto[0]
        : forwardedProto?.split(",")[0]?.trim();
    return req.secure || proto === "https";
}

// Helper function to verify 2FA token
async function verifyTwoFactorToken(token: string, secret: string): Promise<boolean> {
    try {
        const speakeasy = await import('speakeasy');
        return speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token,
            window: 1,
        });
    } catch (error) {
        logger.error("2FA verification error:", error);
        return false;
    }
}

// Helper function to verify backup code
async function verifyBackupCode(userId: string, backupCode: string): Promise<boolean> {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user?.twoFaBackupCodes) return false;

        const codes = user.twoFaBackupCodes as string[];
        const codeIndex = codes.indexOf(backupCode);

        if (codeIndex !== -1) {
            codes.splice(codeIndex, 1);
            await db.update(users)
                .set({ twoFaBackupCodes: codes })
                .where(eq(users.id, userId));
            return true;
        }

        return false;
    } catch (error) {
        logger.error("Backup code verification error:", error);
        return false;
    }
}

// Admin login with password + 2FA
export const adminLoginWithPassword = async (req: Request, res: Response) => {
    try {
        const { phone, password, twoFactorToken, backupCode } = req.body;

        if (!phone) {
            return res.status(400).json({ 
                success: false, 
                message: "Phone number is required" 
            });
        }

        const cleanPhone = String(phone).replace(/\s+/g, "");
        const ipAddress = req.ip || req.socket.remoteAddress;

        const user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone),
        });

        // Check if user exists and is admin
        if (!user || user.role !== "admin") {
            await createAuditLog({
                entityType: "user",
                entityId: cleanPhone,
                action: "admin_login_failed",
                performedBy: cleanPhone,
                performedByRole: "user",
                metadata: { reason: "Invalid credentials or not admin", ip: ipAddress }
            });
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin account required.",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support.",
            });
        }

        // If password is provided, verify it
        if (password) {
            if (!user.passwordHash) {
                return res.status(403).json({
                    success: false,
                    message: "Password not set. Please use OTP login or contact support.",
                });
            }

            const isValidPassword = await bcrypt.compare(password, user.passwordHash);
            if (!isValidPassword) {
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
                    message: "Invalid credentials",
                });
            }
        }

        // Check if 2FA is enabled
        if (user.twoFaEnabled) {
            if (!twoFactorToken && !backupCode) {
                return res.status(200).json({
                    success: true,
                    requiresTwoFactor: true,
                    message: "2FA verification required",
                });
            }

            let twoFactorVerified = false;

            // Verify 2FA token
            if (twoFactorToken && user.twoFaSecret) {
                twoFactorVerified = await verifyTwoFactorToken(twoFactorToken, user.twoFaSecret);
            }
            
            // Or verify backup code
            if (!twoFactorVerified && backupCode) {
                twoFactorVerified = await verifyBackupCode(user.id, backupCode);
            }

            if (!twoFactorVerified) {
                await createAuditLog({
                    entityType: "user",
                    entityId: user.id,
                    action: "admin_login_failed",
                    performedBy: user.id,
                    performedByRole: "admin",
                    metadata: { reason: "Invalid 2FA token", ip: ipAddress }
                });
                return res.status(401).json({
                    success: false,
                    message: "Invalid 2FA code or backup code",
                });
            }
        }

        // Generate JWT token
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            return res.status(500).json({ success: false, message: "Server configuration error" });
        }

        const accessToken = jwt.sign(
            { userId: user.id, type: "access" }, 
            secret, 
            { expiresIn: "4h" }
        );

        const useSecureCookie = isHttpsRequest(req);
        const cookieDomain = getAdminCookieDomain();

        res.cookie(ADMIN_TOKEN_COOKIE, accessToken, {
            httpOnly: true,
            secure: useSecureCookie,
            sameSite: "lax",
            domain: cookieDomain,
            path: "/",
            maxAge: 4 * 60 * 60 * 1000,
        });

        await createAuditLog({
            entityType: "user",
            entityId: user.id,
            action: "admin_login_success",
            performedBy: user.id,
            performedByRole: "admin",
            metadata: { ip: ipAddress, twoFactorUsed: user.twoFaEnabled || false }
        });

        // Get employee profile for permissions
        let employeeProfile = null;
        try {
            const { employeeProfiles } = await import("../db/schema");
            employeeProfile = await db.query.employeeProfiles.findFirst({
                where: eq(employeeProfiles.userId, user.id)
            });
        } catch (error) {
            // Employee profiles table might not exist yet
        }

        return res.status(200).json({
            success: true,
            ...(process.env.NODE_ENV !== "production" ? { token: accessToken } : {}),
            user: {
                id: user.id,
                fullName: user.fullName,
                phoneNumber: user.phoneNumber,
                role: user.role,
                twoFaEnabled: user.twoFaEnabled || false,
                staffRole: employeeProfile?.staffRole || "super_admin",
                permissions: employeeProfile?.permissions || ["*"],
            },
        });
    } catch (error) {
        console.error("Admin login error:", error);
        return res.status(500).json({
            success: false,
            message: "Login failed. Please try again."
        });
    }
};

// Check if admin has 2FA enabled (no authentication required)
export const checkAdminTwoFactorStatus = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ 
                success: false, 
                message: "Phone number is required" 
            });
        }

        const cleanPhone = String(phone).replace(/\s+/g, "");

        const user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone),
        });

        if (!user || user.role !== "admin") {
            return res.status(200).json({ 
                twoFactorEnabled: false 
            });
        }

        return res.status(200).json({ 
            twoFactorEnabled: user.twoFaEnabled || false 
        });
    } catch (error) {
        console.error("Check 2FA status error:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to check 2FA status" 
        });
    }
};

// Admin send OTP (legacy)
export const adminSendOtp = async (req: Request, res: Response) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    const cleanPhone = String(phone).replace(/\s+/g, "");

    const user = await db.query.users.findFirst({
        where: eq(users.phoneNumber, cleanPhone),
    });

    if (!user || user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Unable to send OTP for this account.",
        });
    }

    if (!user.isActive) {
        return res.status(403).json({
            success: false,
            message: "Unable to send OTP for this account.",
        });
    }

    try {
        const otp = await createOtp(cleanPhone, 30 * 60 * 1000);
        if (process.env.NODE_ENV === "production") {
            await sendSms(cleanPhone, `SERVEX: Your ServeX Admin OTP is: ${otp}. Never share this code.`, "otp_admin");
        } else {
            console.log(`[DEV ADMIN OTP] ${cleanPhone}: ${otp}`);
        }
        return res.status(200).json({ success: true, message: "OTP sent successfully" });
    } catch (error) {
        console.error("Admin OTP send error:", error);
        return res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
};

// Admin verify OTP (legacy)
export const adminVerifyOtp = async (req: Request, res: Response) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ success: false, message: "Phone number and OTP are required" });
    }

    const cleanPhone = String(phone).replace(/\s+/g, "");

    try {
        const { verifyOtp: verifyOtpService } = await import("../services/otp");
        await verifyOtpService(cleanPhone, otp);
    } catch (error) {
        if (error instanceof Error && error.message.includes("Too many verification attempts")) {
            return res.status(429).json({ success: false, message: error.message });
        }
        return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    const user = await db.query.users.findFirst({
        where: eq(users.phoneNumber, cleanPhone),
    });

    if (!user || user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Admin access denied" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return res.status(500).json({ success: false, message: "Server configuration error" });
    }

    const accessToken = jwt.sign({ userId: user.id, type: "access" }, secret, { expiresIn: "1h" });

    const useSecureCookie = isHttpsRequest(req);
    const cookieDomain = getAdminCookieDomain();

    res.cookie(ADMIN_TOKEN_COOKIE, accessToken, {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: "lax",
        domain: cookieDomain,
        path: "/",
        maxAge: 60 * 60 * 1000,
    });

    return res.status(200).json({
        success: true,
        ...(process.env.NODE_ENV !== "production" ? { token: accessToken } : {}),
        user: {
            id: user.id,
            fullName: user.fullName,
            phoneNumber: user.phoneNumber,
            role: user.role,
        },
    });
};

// Admin logout
export const adminLogout = async (req: Request, res: Response) => {
    const cookieDomain = getAdminCookieDomain();

    res.clearCookie(ADMIN_TOKEN_COOKIE, {
        httpOnly: true,
        secure: isHttpsRequest(req),
        sameSite: "lax",
        domain: cookieDomain,
        path: "/",
    });

    return res.status(200).json({ success: true, message: "Logged out" });
};