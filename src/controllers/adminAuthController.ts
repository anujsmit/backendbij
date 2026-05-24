import { Request, Response } from "express";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

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

/**
 * ADMIN LOGIN WITH PHONE + PASSWORD
 */
export const adminLogin = async (req: Request, res: Response) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Phone number and password are required",
            });
        }

        const cleanPhone = String(phone).replace(/\s+/g, "");

        const user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone),
        });

        if (!user || user.role !== "admin") {
            return res.status(401).json({
                success: false,
                message: "Invalid phone number or password",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is disabled",
            });
        }

        /**
         * PASSWORD CHECK
         * assumes password field exists in DB
         */
        const isPasswordValid = await bcrypt.compare(
            password,
            user.password
        );

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid phone number or password",
            });
        }

        const secret = process.env.JWT_SECRET;

        if (!secret) {
            return res.status(500).json({
                success: false,
                message: "Server configuration error",
            });
        }

        const accessToken = jwt.sign(
            {
                userId: user.id,
                type: "access",
            },
            secret,
            {
                expiresIn: "1h",
            }
        );

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
            message:"login sucessfull",
            token: accessToken,
            user: {
                id: user.id,
                fullName: user.fullName,
                phoneNumber: user.phoneNumber,
                role: user.role,
            },
        });
    } catch (error) {
        console.error("Admin login error:", error);

        return res.status(500).json({
            success: false,
            message: "Login failed",
        });
    }
};

/**
 * ADMIN LOGOUT
 */
export const adminLogout = async (req: Request, res: Response) => {
    const cookieDomain = getAdminCookieDomain();

    res.clearCookie(ADMIN_TOKEN_COOKIE, {
        httpOnly: true,
        secure: isHttpsRequest(req),
        sameSite: "strict",
        domain: cookieDomain,
        path: "/",
    });

    return res.status(200).json({
        success: true,
        message: "Logged out",
    });
};