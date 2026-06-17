import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { users, mistriProfiles, loginAttempts } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createOtp, verifyOtp as verifyOtpService } from "../services/otp";
import { sendSms } from "../services/sms";
import { logger } from "../utils/logger";

const SALT_ROUNDS = 12;

// Register new user with password
export const registerWithPassword = async (req: Request, res: Response) => {
    try {
        const { phone, fullName, password, dob, role } = req.body;

        // Validation
        if (!phone || !fullName || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Phone number, full name, password, and role are required"
            });
        }

        if (!['user', 'mistri'].includes(role)) {
            return res.status(400).json({
                success: false,
                message: "Invalid role. Must be 'user' or 'mistri'"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format"
            });
        }

        // Validate Nepali date format YYYY-MM-DD (e.g., 2060-04-28)
        if (dob) {
            const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dobRegex.test(dob)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid date format. Expected YYYY-MM-DD"
                });
            }
            
            const [year, month, day] = dob.split('-').map(Number);
            if (year < 1970 || year > 2090) {
                return res.status(400).json({
                    success: false,
                    message: "Year must be between 1970 and 2090 BS"
                });
            }
            if (month < 1 || month > 12) {
                return res.status(400).json({
                    success: false,
                    message: "Month must be between 1 and 12"
                });
            }
            if (day < 1 || day > 32) {
                return res.status(400).json({
                    success: false,
                    message: "Day must be between 1 and 32"
                });
            }
        }

        // Check if user already exists
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

        // Create user - Store Nepali date as is (e.g., "2060-04-28")
        const [newUser] = await db.insert(users).values({
            phoneNumber: cleanPhone,
            fullName: fullName.trim(),
            passwordHash: hashedPassword,
            role: role as any,
            isActive: true,
            isVerified: false,
            dob: dob || null, // Store exactly as "YYYY-MM-DD"
            isOnboarded: false,
        }).returning();

        // Generate OTP for verification
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000);
        
        if (process.env.NODE_ENV === 'production') {
            await sendSms(cleanPhone, `SERVEX: Your verification OTP is: ${otp}`, "otp_login");
        } else {
            console.log(`[DEV OTP] ${cleanPhone}: ${otp}`);
        }

        const accessToken = jwt.sign(
            { userId: newUser.id, type: 'access' },
            process.env.JWT_SECRET!,
            { expiresIn: '7d' }
        );

        return res.status(201).json({
            success: true,
            message: "Registration successful. Please verify your phone number.",
            accessToken,
            user: {
                id: newUser.id,
                phoneNumber: newUser.phoneNumber,
                fullName: newUser.fullName,
                role: newUser.role,
                isVerified: false,
                isOnboarded: false,
                dob: newUser.dob, // Returns "2060-04-28"
            }
        });
    } catch (error) {
        logger.error("Registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Registration failed. Please try again."
        });
    }
};

// Login with password
export const loginWithPassword = async (req: Request, res: Response) => {
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

        const cleanPhone = phone.replace(/\D/g, '');

        // Check for too many failed attempts
        const recentAttempts = await db
            .select({ count: sql<number>`count(*)` })
            .from(loginAttempts)
            .where(
                and(
                    eq(loginAttempts.phoneNumber, cleanPhone),
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

        // Find user
        const user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone)
        });

        if (!user || !user.passwordHash) {
            await db.insert(loginAttempts).values({
                phoneNumber: cleanPhone,
                attemptType: 'password',
                success: false,
                ipAddress,
                userAgent,
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
                attemptType: 'password',
                success: false,
                ipAddress,
                userAgent,
            });
            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // Record successful login
        await db.insert(loginAttempts).values({
            phoneNumber: cleanPhone,
            attemptType: 'password',
            success: true,
            ipAddress,
            userAgent,
        });

        // Update last login
        await db.update(users)
            .set({ lastLoginAt: new Date() })
            .where(eq(users.id, user.id));

        // Get mistri profile if exists
        let approvalStatus = null;
        let hasMistriProfile = false;
        if (user.role === 'mistri') {
            const profile = await db.query.mistriProfiles.findFirst({
                where: eq(mistriProfiles.userId, user.id)
            });
            hasMistriProfile = !!profile;
            approvalStatus = profile?.approvalStatus;
        }

        // Generate token
        const accessToken = jwt.sign(
            { userId: user.id, type: 'access' },
            process.env.JWT_SECRET!,
            { expiresIn: '7d' }
        );

        return res.json({
            success: true,
            message: "Login successful",
            accessToken,
            user: {
                id: user.id,
                phoneNumber: user.phoneNumber,
                fullName: user.fullName,
                role: user.role,
                isVerified: user.isVerified,
                isOnboarded: user.isOnboarded,
                approvalStatus,
                hasMistriProfile,
                dob: user.dob,
            }
        });
    } catch (error) {
        logger.error("Login error:", error);
        return res.status(500).json({
            success: false,
            message: "Login failed. Please try again."
        });
    }
};

// Verify OTP (for phone verification)
export const verifyOtpForVerification = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone and OTP are required"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        
        // Verify OTP
        await verifyOtpService(cleanPhone, otp);

        // Update user as verified
        const [updatedUser] = await db.update(users)
            .set({ isVerified: true })
            .where(eq(users.phoneNumber, cleanPhone))
            .returning();

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.json({
            success: true,
            message: "Phone number verified successfully",
            user: {
                id: updatedUser.id,
                phoneNumber: updatedUser.phoneNumber,
                fullName: updatedUser.fullName,
                role: updatedUser.role,
                isVerified: updatedUser.isVerified,
                isOnboarded: updatedUser.isOnboarded,
            }
        });
    } catch (error) {
        logger.error("OTP verification error:", error);
        return res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : "Invalid or expired OTP"
        });
    }
};

// Resend OTP
export const resendOtp = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        const otp = await createOtp(cleanPhone, 10 * 60 * 1000);

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
        logger.error("Resend OTP error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};

// Check if user exists (for registration flow)
export const checkUserExists = async (req: Request, res: Response) => {
    try {
        const { phone } = req.query;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = (phone as string).replace(/\D/g, '');
        const user = await db.query.users.findFirst({
            where: eq(users.phoneNumber, cleanPhone)
        });

        return res.json({
            success: true,
            exists: !!user,
            isVerified: user?.isVerified || false,
            role: user?.role || null,
        });
    } catch (error) {
        logger.error("Check user error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to check user existence"
        });
    }
};

// Change password (authenticated)
export const changePassword = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
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

        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await db.update(users)
            .set({ passwordHash: hashedPassword })
            .where(eq(users.id, userId));

        return res.json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        logger.error("Change password error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to change password"
        });
    }
};