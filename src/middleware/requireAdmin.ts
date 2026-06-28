// backend/src/middleware/requireAdmin.ts
import { Request, Response, NextFunction } from "express";

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    // ✅ Use accountType instead of role
    const accountType = (req as any).accountType;
    const user = (req as any).user;

    // Check both accountType and user.role for backward compatibility
    if (accountType !== 'admin' && user?.accountType !== 'admin' && user?.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: "Admin access required"
        });
    }

    next();
};