// backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { 
    users, 
    userAccounts, 
    mistriAccounts 
} from "../db/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

// ============================================
// TYPE EXTENSIONS
// ============================================

declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: string;
                type: string;
                accountType: string;
            };
            accountType?: string;
        }
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function findUserById(id: string, accountType: string) {
    if (accountType === 'admin') {
        return await db.query.users.findFirst({
            where: eq(users.id, id),
        });
    } else if (accountType === 'mistri') {
        return await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, id),
        });
    } else if (accountType === 'user') {
        return await db.query.userAccounts.findFirst({
            where: eq(userAccounts.id, id),
        });
    }
    return null;
}

function extractToken(req: Request): string | null {
    // Check Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }

    // Fallback to cookie for admin panel
    const cookieHeader = req.headers.cookie ?? "";
    const cookieToken = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("admin_token="))
        ?.split("=")[1];

    return cookieToken || null;
}

// ============================================
// GENERIC AUTHENTICATE (Supports all account types)
// ============================================

export const authenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. No token provided.",
            });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            logger.error("JWT_SECRET not defined in environment variables");
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }

        // Verify token
        const decoded = jwt.verify(token, secret) as {
            userId: string;
            type: string;
            accountType: string;
        };

        // Find user in the appropriate table
        const user = await findUserById(decoded.userId, decoded.accountType);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found",
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support.",
            });
        }

        // Attach user data to request
        (req as any).user = decoded;
        (req as any).accountType = decoded.accountType;

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                success: false,
                message: "Invalid token. Please authenticate again.",
            });
        }
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({
                success: false,
                message: "Token expired. Please authenticate again.",
            });
        }

        logger.error("Authentication error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error during authentication",
        });
    }
};

// ============================================
// ADMIN AUTHENTICATE
// ============================================

export const authenticateAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Access token required",
            });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            logger.error("JWT_SECRET not defined in environment variables");
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }

        const decoded = jwt.verify(token, secret) as {
            userId: string;
            type: string;
            accountType: string;
        };

        // ✅ Only allow admin role
        if (decoded.accountType !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Admin access required",
            });
        }

        // ✅ Verify admin exists in users table
        const admin = await db.query.users.findFirst({
            where: eq(users.id, decoded.userId),
        });

        if (!admin || admin.role !== 'admin') {
            return res.status(404).json({
                success: false,
                message: "Admin user not found",
            });
        }

        // ✅ Check if admin is active
        if (!admin.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support.",
            });
        }

        (req as any).user = decoded;
        (req as any).accountType = 'admin';

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({
                success: false,
                message: "Token expired",
            });
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
            });
        }

        logger.error("Admin authentication error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

// ============================================
// MISTRI AUTHENTICATE
// ============================================

export const authenticateMistri = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Access token required",
            });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            logger.error("JWT_SECRET not defined in environment variables");
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }

        const decoded = jwt.verify(token, secret) as {
            userId: string;
            type: string;
            accountType: string;
        };

        // ✅ Only allow mistri role
        if (decoded.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Mistri access required",
            });
        }

        // ✅ Verify mistri exists in mistriAccounts table
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, decoded.userId),
        });

        if (!mistri || mistri.accountType !== 'mistri') {
            return res.status(404).json({
                success: false,
                message: "Mistri user not found",
            });
        }

        // ✅ Check if mistri is active
        if (!mistri.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support.",
            });
        }

        (req as any).user = decoded;
        (req as any).accountType = 'mistri';

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({
                success: false,
                message: "Token expired",
            });
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
            });
        }

        logger.error("Mistri authentication error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

// ============================================
// USER AUTHENTICATE (Customer)
// ============================================

export const authenticateUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Access token required",
            });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            logger.error("JWT_SECRET not defined in environment variables");
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }

        const decoded = jwt.verify(token, secret) as {
            userId: string;
            type: string;
            accountType: string;
        };

        // ✅ Only allow user role
        if (decoded.accountType !== 'user') {
            return res.status(403).json({
                success: false,
                message: "User access required",
            });
        }

        // ✅ Verify user exists in userAccounts table
        const user = await db.query.userAccounts.findFirst({
            where: eq(userAccounts.id, decoded.userId),
        });

        if (!user || user.accountType !== 'user') {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // ✅ Check if user is active
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated. Contact support.",
            });
        }

        (req as any).user = decoded;
        (req as any).accountType = 'user';

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({
                success: false,
                message: "Token expired",
            });
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
            });
        }

        logger.error("User authentication error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

// ============================================
// ROLE CHECK MIDDLEWARE
// ============================================

export const requireAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if ((req as any).accountType !== 'admin') {
        return res.status(403).json({
            success: false,
            message: "Admin access required",
        });
    }
    next();
};

export const requireMistri = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if ((req as any).accountType !== 'mistri') {
        return res.status(403).json({
            success: false,
            message: "Mistri access required",
        });
    }
    next();
};

export const requireUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if ((req as any).accountType !== 'user') {
        return res.status(403).json({
            success: false,
            message: "User access required",
        });
    }
    next();
};

// ============================================
// OPTIONAL AUTHENTICATION (For public routes with optional auth)
// ============================================

export const optionalAuthenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = extractToken(req);

        if (!token) {
            // No token, continue as guest
            return next();
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            return next();
        }

        const decoded = jwt.verify(token, secret) as {
            userId: string;
            type: string;
            accountType: string;
        };

        const user = await findUserById(decoded.userId, decoded.accountType);

        if (user && user.isActive) {
            (req as any).user = decoded;
            (req as any).accountType = decoded.accountType;
        }

        next();
    } catch (error) {
        // If token is invalid, continue as guest
        next();
    }
};