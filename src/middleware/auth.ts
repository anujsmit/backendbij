import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { users } from "../db/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";

// Extend Express Request type to include user
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                phoneNumber: string;
                role: string;
            };
        }
    }
}

export const authenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Accept Bearer token first; fall back to HttpOnly cookie for admin panel.
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith("Bearer ")
            ? authHeader.split(" ")[1]
            : null;

        const cookieHeader = req.headers.cookie ?? "";
        const cookieToken = cookieHeader
            .split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("admin_token="))
            ?.split("=")[1];

        const token = bearerToken ?? cookieToken;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. No token provided.",
            });
        }

        const secret = process.env.JWT_SECRET;

        if (!secret) {
            console.error("JWT_SECRET not defined in environment variables");
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }

        // Verify token
        const decoded = jwt.verify(token, secret) as {
            userId: string;
            type?: string;
            phoneNumber?: string;
            role?: string;
        };

        // Check if user exists in database
        const userData = await db
            .select()
            .from(users)
            .where(eq(users.id, decoded.userId))
            .limit(1);

        if (userData.length === 0) {
            return res.status(401).json({
                success: false,
                message: "User not found",
            });
        }

        // Attach user data to request object
        req.user = {
            id: decoded.userId,
            phoneNumber: userData[0].phoneNumber || '',
            role: userData[0].role || 'user',
        };

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                success: false,
                message: "Invalid token. Please authenticate again.",
            });
        }

        console.error("Authentication error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error during authentication",
        });
    }
};
