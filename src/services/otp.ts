import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { otps } from "../db/schema";
import { generateOtp } from "../lib/otp";
import { sql } from "drizzle-orm";

// In-memory tracker for failed verification attempts
const verificationAttempts = new Map<string, { count: number; lastAttempt: number }>();

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

/**
 * Creates a new OTP for a given phone number.
 * CRITICAL FIX: Removed verificationAttempts.delete() so that spamming 
 * the signup endpoint cannot reset the brute-force protection map.
 */
export const createOtp = async (phone: string) => {
  const cleanPhone = phone.replace(/\s+/g, '');

  // Delete any existing OTPs in the database for this phone number
  await db.delete(otps).where(eq(otps.phone, cleanPhone));

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
  
  if (process.env.NODE_ENV !== "production") {
    console.log(`[OTP GENERATED] ${cleanPhone}: ${otp}`);
  }

  await db.insert(otps).values({ phone: cleanPhone, otp, expiresAt });
  return otp;
};

/**
 * Verifies an OTP against the database and enforces strict rate-limiting.
 */
export const verifyOtp = async (phone: string, otp: string) => {
  const cleanPhone = phone.replace(/\s+/g, '');
  const now = Date.now();
  
  // 1. Check Rate Limiting State
  const attempts = verificationAttempts.get(cleanPhone);

  if (attempts) {
    if (now - attempts.lastAttempt > RATE_LIMIT_WINDOW) {
      // Window expired; reset tracking
      verificationAttempts.set(cleanPhone, { count: 1, lastAttempt: now });
    } else if (attempts.count >= MAX_ATTEMPTS) {
      console.log(`Rate limit exceeded for phone: ${cleanPhone}`);
      throw new Error("Too many verification attempts. Please try again later.");
    } else {
      // Increment counter immediately to prevent race conditions / parallel brute force
      attempts.count++;
      attempts.lastAttempt = now;
    }
  } else {
    verificationAttempts.set(cleanPhone, { count: 1, lastAttempt: now });
  }

  // 2. Validate Format
  const cleanOtp = String(otp).trim();
  if (!/^\d{6}$/.test(cleanOtp)) {
    throw new Error("Invalid OTP format. Must be a 6-digit number.");
  }

  // 3. Database Lookup
  const [otpData] = await db
    .select()
    .from(otps)
    .where(and(eq(otps.phone, cleanPhone), eq(otps.otp, cleanOtp)))
    .orderBy(sql`${otps.expiresAt} DESC`)
    .limit(1);

  if (!otpData) {
    throw new Error("Invalid OTP");
  }

  // 4. Expiry Check
  if (otpData.expiresAt < new Date()) {
    throw new Error("OTP has expired");
  }

  // 5. Cleanup on SUCCESS
  // Only remove tracking maps when verification completely passes!
  verificationAttempts.delete(cleanPhone);
  await db.delete(otps).where(eq(otps.id, otpData.id));

  return true;
};