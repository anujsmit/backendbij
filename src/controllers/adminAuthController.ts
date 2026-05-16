import { Request, Response } from "express";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { createOtp, verifyOtp as verifyOtpService } from "../services/otp";
import { sendSms } from "../services/sms";
import jwt from "jsonwebtoken";

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
        const otp = await createOtp(cleanPhone);
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

export const adminVerifyOtp = async (req: Request, res: Response) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ success: false, message: "Phone number and OTP are required" });
    }

    const cleanPhone = String(phone).replace(/\s+/g, "");

    try {
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
        sameSite: "strict",
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

export const adminLogout = async (req: Request, res: Response) => {
    const cookieDomain = getAdminCookieDomain();

    res.clearCookie(ADMIN_TOKEN_COOKIE, {
        httpOnly: true,
        secure: isHttpsRequest(req),
        sameSite: "strict",
        domain: cookieDomain,
        path: "/",
    });

    return res.status(200).json({ success: true, message: "Logged out" });
};
