// backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { users } from "../db/schema";
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

/**
 * Find a user by ID in the unified users table
 */
async function findUserById(id: string) {
    return await db.query.users.findFirst({
        where: eq(users.id, id),
    });
}

/**
 * Extract JWT token from request
 */
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

/**
 * Verify JWT token and return decoded payload
 */
function verifyToken(token: string): { userId: string; type: string; accountType: string } {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        logger.error("JWT_SECRET not defined in environment variables");
        throw new Error("JWT_SECRET not configured");
    }

    return jwt.verify(token, secret) as {
        userId: string;
        type: string;
        accountType: string;
    };
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

        // Verify token
        const decoded = verifyToken(token);

        // ✅ Log for debugging
        logger.debug('[Auth] Decoded token:', {
            userId: decoded.userId,
            type: decoded.type,
            accountType: decoded.accountType,
        });

        // Find user in unified users table
        const user = await findUserById(decoded.userId);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found",
            });
        }

        // ✅ Check account type matches
        if (user.accountType !== decoded.accountType) {
            logger.warn('[Auth] Account type mismatch:', {
                tokenAccountType: decoded.accountType,
                dbAccountType: user.accountType,
            });
            return res.status(401).json({
                success: false,
                message: "Invalid account type",
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
        (req as any).user = {
            userId: decoded.userId,
            accountType: decoded.accountType,
            type: decoded.type,
        };
        (req as any).accountType = decoded.accountType;

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            logger.warn('[Auth] JWT Error:', error.message);
            return res.status(401).json({
                success: false,
                message: "Invalid token. Please authenticate again.",
            });
        }
        if (error instanceof jwt.TokenExpiredError) {
            logger.warn('[Auth] Token expired');
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

        const decoded = verifyToken(token);

        // ✅ Only allow admin role
        if (decoded.accountType !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Admin access required",
            });
        }

        // ✅ Verify admin exists in unified users table
        const admin = await db.query.users.findFirst({
            where: eq(users.id, decoded.userId),
        });

        if (!admin || admin.accountType !== 'admin') {
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

        const decoded = verifyToken(token);

        // ✅ Only allow mistri role
        if (decoded.accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Mistri access required",
            });
        }

        // ✅ Verify mistri exists in unified users table
        const mistri = await db.query.users.findFirst({
            where: eq(users.id, decoded.userId),
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

        const decoded = verifyToken(token);

        // ✅ Only allow user role
        if (decoded.accountType !== 'user') {
            return res.status(403).json({
                success: false,
                message: "User access required",
            });
        }

        // ✅ Verify user exists in unified users table
        const user = await db.query.users.findFirst({
            where: eq(users.id, decoded.userId),
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
    const accountType = (req as any).accountType;
    const user = (req as any).user;

    logger.debug('[requireAdmin] Account type:', accountType);
    logger.debug('[requireAdmin] User:', user);

    if (!accountType || accountType !== 'admin') {
        return res.status(403).json({
            success: false,
            message: `Admin access required. Your role: ${accountType || 'none'}`,
        });
    }

    // ✅ Verify in database
    try {
        const adminUser = await db.query.users.findFirst({
            where: eq(users.id, user.userId),
        });

        if (!adminUser || adminUser.accountType !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Admin user not found or invalid role",
            });
        }

        if (!adminUser.isActive) {
            return res.status(403).json({
                success: false,
                message: "Admin account is deactivated",
            });
        }
    } catch (error) {
        logger.error('[requireAdmin] Database error:', error);
        return res.status(500).json({
            success: false,
            message: "Error verifying admin status",
        });
    }

    next();
};

export const requireMistri = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const accountType = (req as any).accountType;

    if (!accountType || accountType !== 'mistri') {
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
    const accountType = (req as any).accountType;

    if (!accountType || accountType !== 'user') {
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

        const decoded = verifyToken(token);
        const user = await findUserById(decoded.userId);

        if (user && user.isActive && user.accountType === decoded.accountType) {
            (req as any).user = decoded;
            (req as any).accountType = decoded.accountType;
        }

        next();
    } catch (error) {
        // If token is invalid, continue as guest
        next();
    }
};

// ============================================
// MULTI-ROLE AUTHENTICATE
// ============================================

/**
 * Authenticate and allow multiple roles
 * Usage: authenticateRoles(['admin', 'mistri'])
 */
export const authenticateRoles = (allowedRoles: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const token = extractToken(req);

            if (!token) {
                return res.status(401).json({
                    success: false,
                    message: "Authentication required",
                });
            }

            const decoded = verifyToken(token);

            // Check if user's role is allowed
            if (!allowedRoles.includes(decoded.accountType)) {
                return res.status(403).json({
                    success: false,
                    message: `Access denied. Allowed roles: ${allowedRoles.join(', ')}`,
                });
            }

            // Verify user exists in unified users table
            const user = await findUserById(decoded.userId);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "User not found",
                });
            }

            if (user.accountType !== decoded.accountType) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid account type",
                });
            }

            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    message: "Account is deactivated",
                });
            }

            (req as any).user = decoded;
            (req as any).accountType = decoded.accountType;

            next();
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid token",
                });
            }
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({
                    success: false,
                    message: "Token expired",
                });
            }

            logger.error("Role authentication error:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };
};

// ============================================
// AUTHENTICATE WITH PERMISSION CHECK
// ============================================

/**
 * Authenticate and check specific permissions
 * Usage: authenticateWithPermission('manage_users')
 */
export const authenticateWithPermission = (requiredPermission: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const token = extractToken(req);

            if (!token) {
                return res.status(401).json({
                    success: false,
                    message: "Authentication required",
                });
            }

            const decoded = verifyToken(token);

            // Only admins have permissions
            if (decoded.accountType !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: "Admin access required",
                });
            }

            // Verify admin exists
            const admin = await db.query.users.findFirst({
                where: eq(users.id, decoded.userId),
            });

            if (!admin || admin.accountType !== 'admin') {
                return res.status(404).json({
                    success: false,
                    message: "Admin user not found",
                });
            }

            if (!admin.isActive) {
                return res.status(403).json({
                    success: false,
                    message: "Account is deactivated",
                });
            }

            // Get employee profile for permissions
            try {
                const { employeeProfiles } = await import("../db/schema");
                const profile = await db.query.employeeProfiles.findFirst({
                    where: eq(employeeProfiles.userId, decoded.userId),
                });

                if (profile) {
                    const permissions = profile.permissions as string[] || [];
                    if (!permissions.includes(requiredPermission) && !permissions.includes('*')) {
                        return res.status(403).json({
                            success: false,
                            message: `Permission '${requiredPermission}' required`,
                        });
                    }
                }
            } catch (error) {
                // If employee_profiles table doesn't exist, skip permission check
                logger.debug("Employee profiles table not found, skipping permission check");
            }

            (req as any).user = decoded;
            (req as any).accountType = 'admin';

            next();
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid token",
                });
            }
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({
                    success: false,
                    message: "Token expired",
                });
            }

            logger.error("Permission authentication error:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };
};