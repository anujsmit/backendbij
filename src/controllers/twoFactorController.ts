import { Request, Response } from "express";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { createAuditLog } from "../services/auditLog";
import { logger } from "../utils/logger";

// Generate 2FA secret and QR code
export const setupTwoFactor = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Generate secret
        const secret = speakeasy.generateSecret({
            name: `ServeX Admin: ${user.fullName || user.phoneNumber}`,
            issuer: "ServeX",
            length: 20,
        });

        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

        // Store secret temporarily (will be enabled after verification)
        await db.update(users)
            .set({ twoFaSecret: secret.base32 })
            .where(eq(users.id, userId));

        await createAuditLog({
            entityType: "user",
            entityId: userId,
            action: "two_factor_setup_initiated",
            performedBy: userId,
            performedByRole: user.role as any,
        });

        return res.json({
            success: true,
            secret: secret.base32,
            qrCode: qrCodeUrl,
            otpauthUrl: secret.otpauth_url,
        });
    } catch (error) {
        logger.error("2FA setup error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to setup 2FA"
        });
    }
};

// Verify and enable 2FA
export const enableTwoFactor = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { token, backupCodes } = req.body;

        if (!userId || !token) {
            return res.status(400).json({ success: false, message: "Token is required" });
        }

        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user || !user.twoFaSecret) {
            return res.status(404).json({ success: false, message: "2FA setup not initiated" });
        }

        // Verify token
        const verified = speakeasy.totp.verify({
            secret: user.twoFaSecret,
            encoding: 'base32',
            token: token,
            window: 1, // Allow 1 step window for time drift
        });

        if (!verified) {
            return res.status(400).json({ success: false, message: "Invalid 2FA token" });
        }

        // Generate backup codes
        const backupCodesArray = backupCodes || Array.from({ length: 8 }, () => 
            Math.random().toString(36).substring(2, 10).toUpperCase()
        );

        // Enable 2FA
        await db.update(users)
            .set({
                twoFaEnabled: true,
                twoFaBackupCodes: backupCodesArray,
            })
            .where(eq(users.id, userId));

        await createAuditLog({
            entityType: "user",
            entityId: userId,
            action: "two_factor_enabled",
            performedBy: userId,
            performedByRole: user.role as any,
        });

        return res.json({
            success: true,
            message: "2FA enabled successfully",
            backupCodes: backupCodesArray,
        });
    } catch (error) {
        logger.error("Enable 2FA error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to enable 2FA"
        });
    }
};

// Disable 2FA
export const disableTwoFactor = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { token } = req.body;

        if (!userId || !token) {
            return res.status(400).json({ success: false, message: "Token is required" });
        }

        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Verify token before disabling
        if (user.twoFaSecret) {
            const verified = speakeasy.totp.verify({
                secret: user.twoFaSecret,
                encoding: 'base32',
                token: token,
                window: 1,
            });

            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid 2FA token" });
            }
        }

        // Disable 2FA
        await db.update(users)
            .set({
                twoFaSecret: null,
                twoFaEnabled: false,
                twoFaBackupCodes: null,
            })
            .where(eq(users.id, userId));

        await createAuditLog({
            entityType: "user",
            entityId: userId,
            action: "two_factor_disabled",
            performedBy: userId,
            performedByRole: user.role as any,
        });

        return res.json({
            success: true,
            message: "2FA disabled successfully",
        });
    } catch (error) {
        logger.error("Disable 2FA error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to disable 2FA"
        });
    }
};

// Verify 2FA token during login
export const verifyTwoFactorToken = async (token: string, userSecret: string): Promise<boolean> => {
    try {
        return speakeasy.totp.verify({
            secret: userSecret,
            encoding: 'base32',
            token: token,
            window: 1,
        });
    } catch (error) {
        logger.error("2FA verification error:", error);
        return false;
    }
};

// Verify backup code
export const verifyBackupCode = async (userId: string, backupCode: string): Promise<boolean> => {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user?.twoFaBackupCodes) return false;

        const codes = user.twoFaBackupCodes as string[];
        const codeIndex = codes.indexOf(backupCode);

        if (codeIndex !== -1) {
            // Remove used backup code
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
};