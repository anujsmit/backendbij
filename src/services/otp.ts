// backend/src/services/otp.ts
import { eq, and, lt } from "drizzle-orm";
import { db } from "../db";
import { otps } from "../db/schema";
import { generateOtp } from "../lib/otp";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

// ============================================
// CONSTANTS
// ============================================

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// In-memory rate limiting store
const verificationAttempts = new Map<string, { count: number; lastAttempt: number }>();

// Google Play / App Store review demo accounts.
const REVIEW_OTP_ACCOUNTS: Record<string, string> = {
  "9800000001": "696969", // customer demo (Sakshyam Baral)
  "9822182869": "696969", // provider demo (Alok Subedi, approved mistri)
};

// Account type literals
type AccountType = 'user' | 'mistri' | 'admin';

// ============================================
// HELPER FUNCTIONS
// ============================================

export const isReviewAccount = (phone: string): boolean => {
  return Object.prototype.hasOwnProperty.call(REVIEW_OTP_ACCOUNTS, phone.replace(/\s+/g, ''));
};

// ============================================
// CREATE OTP
// ============================================

export const createOtp = async (
  phone: string, 
  ttlMs: number = 15 * 60 * 1000,
  accountType: AccountType = 'user'
): Promise<string> => {
  try {
    const cleanPhone = phone.replace(/\s+/g, '');

    // Clear rate limiting for this phone
    verificationAttempts.delete(cleanPhone);

    // Only purge EXPIRED codes for this phone and account type
    await db.delete(otps).where(
      and(
        eq(otps.phone, cleanPhone),
        eq(otps.accountType, accountType),
        lt(otps.expiresAt, new Date())
      )
    );

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + ttlMs);

    // Insert OTP with account type
    await db.insert(otps).values({ 
      phone: cleanPhone, 
      otp, 
      accountType: accountType,
      expiresAt,
      attempts: 0,
      lockedUntil: null,
    });

    logger.info(`OTP created for ${cleanPhone} (${accountType})`);
    return otp;
  } catch (error) {
    logger.error("Error creating OTP:", error);
    throw new Error("Failed to create OTP");
  }
};

// ============================================
// VERIFY OTP
// ============================================

export const verifyOtp = async (
  phone: string, 
  otp: string,
  accountType: AccountType = 'user'
): Promise<boolean> => {
  try {
    const cleanPhone = phone.replace(/\s+/g, '');
    const cleanOtp = String(otp).trim();

    // Check if it's a review account
    const reviewCode = REVIEW_OTP_ACCOUNTS[cleanPhone];
    if (reviewCode !== undefined) {
      if (cleanOtp === reviewCode) {
        return true;
      }
      throw new Error("Invalid OTP");
    }

    // Rate limiting check
    const now = Date.now();
    const attempts = verificationAttempts.get(cleanPhone);

    if (attempts) {
      if (now - attempts.lastAttempt > RATE_LIMIT_WINDOW) {
        verificationAttempts.set(cleanPhone, { count: 1, lastAttempt: now });
      } else if (attempts.count >= MAX_ATTEMPTS) {
        logger.warn(`Rate limit exceeded for phone: ${cleanPhone}`);
        throw new Error("Too many verification attempts. Please try again later.");
      } else {
        attempts.count++;
        attempts.lastAttempt = now;
      }
    } else {
      verificationAttempts.set(cleanPhone, { count: 1, lastAttempt: now });
    }

    // Validate OTP format
    if (!/^\d{6}$/.test(cleanOtp)) {
      throw new Error("Invalid OTP format");
    }

    // Find OTP in database with account type
    const [otpData] = await db
      .select()
      .from(otps)
      .where(
        and(
          eq(otps.phone, cleanPhone),
          eq(otps.otp, cleanOtp),
          eq(otps.accountType, accountType)
        )
      )
      .orderBy(sql`${otps.expiresAt} DESC`)
      .limit(1);

    if (!otpData) {
      // Increment failed attempt
      const existing = verificationAttempts.get(cleanPhone);
      if (existing) {
        existing.count++;
      }
      throw new Error("Invalid OTP");
    }

    // Check if locked
    if (otpData.lockedUntil && new Date(otpData.lockedUntil) > new Date()) {
      throw new Error("Too many failed attempts. Please try again later.");
    }

    // Check attempts (handle null)
    const attemptsCount = otpData.attempts ?? 0;
    if (attemptsCount >= 5) {
      // Lock for 15 minutes
      await db.update(otps)
        .set({ lockedUntil: new Date(Date.now() + 15 * 60 * 1000) })
        .where(eq(otps.id, otpData.id));
      throw new Error("Too many failed attempts. Please try again later.");
    }

    // Check expiry
    if (otpData.expiresAt < new Date()) {
      throw new Error("OTP has expired");
    }

    // Success - clean up
    verificationAttempts.delete(cleanPhone);

    // Delete the used OTP
    await db.delete(otps).where(eq(otps.id, otpData.id));

    logger.info(`OTP verified for ${cleanPhone} (${accountType})`);
    return true;
  } catch (error) {
    logger.error("Error verifying OTP:", error);
    throw error;
  }
};

// ============================================
// RESEND OTP
// ============================================

export const resendOtp = async (
  phone: string, 
  ttlMs: number = 15 * 60 * 1000,
  accountType: AccountType = 'user'
): Promise<string> => {
  try {
    const cleanPhone = phone.replace(/\s+/g, '');

    // Delete existing OTPs for this phone and account type
    await db.delete(otps).where(
      and(
        eq(otps.phone, cleanPhone),
        eq(otps.accountType, accountType)
      )
    );

    // Create new OTP
    return await createOtp(cleanPhone, ttlMs, accountType);
  } catch (error) {
    logger.error("Error resending OTP:", error);
    throw new Error("Failed to resend OTP");
  }
};

// ============================================
// CLEAN UP EXPIRED OTPS (Background job)
// ============================================

export const cleanupExpiredOtps = async (): Promise<void> => {
  try {
    await db.delete(otps)
      .where(lt(otps.expiresAt, new Date()));
    
    logger.info(`Cleaned up expired OTPs`);
  } catch (error) {
    logger.error("Error cleaning up expired OTPs:", error);
  }
};

// ============================================
// GET OTP STATUS (For debugging)
// ============================================

export const getOtpStatus = async (
  phone: string,
  accountType: AccountType = 'user'
): Promise<{ exists: boolean; expiresAt: Date | null; attempts: number }> => {
  try {
    const cleanPhone = phone.replace(/\s+/g, '');
    
    const [otpData] = await db
      .select({
        expiresAt: otps.expiresAt,
        attempts: otps.attempts,
      })
      .from(otps)
      .where(
        and(
          eq(otps.phone, cleanPhone),
          eq(otps.accountType, accountType),
          lt(otps.expiresAt, new Date())
        )
      )
      .orderBy(sql`${otps.expiresAt} DESC`)
      .limit(1);

    if (!otpData) {
      return { exists: false, expiresAt: null, attempts: 0 };
    }

    return {
      exists: true,
      expiresAt: otpData.expiresAt,
      attempts: otpData.attempts ?? 0,
    };
  } catch (error) {
    logger.error("Error getting OTP status:", error);
    return { exists: false, expiresAt: null, attempts: 0 };
  }
};

// ============================================
// DELETE OTP (For manual cleanup)
// ============================================

export const deleteOtp = async (
  phone: string,
  accountType: AccountType = 'user'
): Promise<void> => {
  try {
    const cleanPhone = phone.replace(/\s+/g, '');
    await db.delete(otps).where(
      and(
        eq(otps.phone, cleanPhone),
        eq(otps.accountType, accountType)
      )
    );
    logger.info(`OTP deleted for ${cleanPhone} (${accountType})`);
  } catch (error) {
    logger.error("Error deleting OTP:", error);
    throw error;
  }
};

// ============================================
// VERIFY OTP WITH ATTEMPTS TRACKING
// ============================================

export const verifyOtpWithAttempts = async (
  phone: string,
  otp: string,
  accountType: AccountType = 'user'
): Promise<{ success: boolean; attemptsRemaining: number }> => {
  try {
    const cleanPhone = phone.replace(/\s+/g, '');
    const cleanOtp = String(otp).trim();

    // Check if it's a review account
    const reviewCode = REVIEW_OTP_ACCOUNTS[cleanPhone];
    if (reviewCode !== undefined) {
      if (cleanOtp === reviewCode) {
        return { success: true, attemptsRemaining: 5 };
      }
      throw new Error("Invalid OTP");
    }

    // Find OTP in database
    const [otpData] = await db
      .select()
      .from(otps)
      .where(
        and(
          eq(otps.phone, cleanPhone),
          eq(otps.accountType, accountType),
          lt(otps.expiresAt, new Date())
        )
      )
      .orderBy(sql`${otps.expiresAt} DESC`)
      .limit(1);

    if (!otpData) {
      throw new Error("Invalid OTP");
    }

    // Check attempts
    const attemptsCount = otpData.attempts ?? 0;
    const remaining = 5 - attemptsCount;

    if (otpData.otp !== cleanOtp) {
      // Increment attempts
      await db.update(otps)
        .set({ attempts: attemptsCount + 1 })
        .where(eq(otps.id, otpData.id));

      if (attemptsCount + 1 >= 5) {
        await db.update(otps)
          .set({ lockedUntil: new Date(Date.now() + 15 * 60 * 1000) })
          .where(eq(otps.id, otpData.id));
        throw new Error("Too many failed attempts. Please try again later.");
      }

      throw new Error(`Invalid OTP. ${remaining - 1} attempts remaining.`);
    }

    // Check expiry
    if (otpData.expiresAt < new Date()) {
      throw new Error("OTP has expired");
    }

    // Success
    await db.delete(otps).where(eq(otps.id, otpData.id));

    return { success: true, attemptsRemaining: 5 };
  } catch (error) {
    logger.error("Error verifying OTP with attempts:", error);
    throw error;
  }
};