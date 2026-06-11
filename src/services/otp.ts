import { eq, and, lt } from "drizzle-orm";
import { db } from "../db";
import { otps } from "../db/schema";
import { generateOtp } from "../lib/otp";
import { sql } from "drizzle-orm";

const verificationAttempts = new Map<string, { count: number; lastAttempt: number }>();

const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Google Play / App Store review demo accounts.
// Store reviewers cannot receive our Nepali SMS OTP, so these specific numbers
// skip SMS entirely and accept a fixed code. They map to pre-provisioned demo
// users (a customer + an approved mistri) that hold no elevated privileges.
const REVIEW_OTP_ACCOUNTS: Record<string, string> = {
  "9800000001": "696969", // customer demo  (Sakshyam Baral)
  "9822182869": "696969", // provider demo  (Alok Subedi, approved mistri)
};

export const isReviewAccount = (phone: string): boolean =>
  Object.prototype.hasOwnProperty.call(REVIEW_OTP_ACCOUNTS, phone.replace(/\s+/g, ''));

export const createOtp = async (phone: string, ttlMs: number = 15 * 60 * 1000) => {
  const cleanPhone = phone.replace(/\s+/g, '');

  verificationAttempts.delete(cleanPhone);

  // Only purge EXPIRED codes. Previously this deleted ALL prior OTPs on every
  // send/resend — so when a slow SMS finally arrived its code was already gone
  // ("Invalid or expired OTP"). Keeping unexpired codes valid means a late SMS
  // (and any resend) still work; verifyOtp matches whichever code is entered.
  await db.delete(otps).where(and(eq(otps.phone, cleanPhone), lt(otps.expiresAt, new Date())));

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + ttlMs);

  await db.insert(otps).values({ phone: cleanPhone, otp, expiresAt });

  return otp;
};

export const verifyOtp = async (phone: string, otp: string) => {
  const cleanPhone = phone.replace(/\s+/g, '');

  // Store-review demo accounts: accept the fixed code, skip rate-limit + DB lookup.
  const reviewCode = REVIEW_OTP_ACCOUNTS[cleanPhone];
  if (reviewCode !== undefined) {
    if (String(otp).trim() === reviewCode) {
      return true;
    }
    throw new Error("Invalid OTP");
  }

  const now = Date.now();
  const attempts = verificationAttempts.get(cleanPhone);

  if (attempts) {
    if (now - attempts.lastAttempt > RATE_LIMIT_WINDOW) {
      verificationAttempts.set(cleanPhone, { count: 1, lastAttempt: now });
    } else if (attempts.count >= MAX_ATTEMPTS) {
      console.log(`Rate limit exceeded for phone: ${cleanPhone}`);
      throw new Error("Too many verification attempts. Please try again later.");
    } else {
      attempts.count++;
      attempts.lastAttempt = now;
    }
  } else {
    verificationAttempts.set(cleanPhone, { count: 1, lastAttempt: now });
  }

  const cleanOtp = String(otp).trim();

  if (!/^\d{6}$/.test(cleanOtp)) {
    throw new Error("Invalid OTP format");
  }

  const [otpData] = await db
    .select()
    .from(otps)
    .where(and(eq(otps.phone, cleanPhone), eq(otps.otp, cleanOtp)))
    .orderBy(sql`${otps.expiresAt} DESC`)
    .limit(1);

  if (!otpData) {
    throw new Error("Invalid OTP");
  }

  if (otpData.expiresAt < new Date()) {
    throw new Error("OTP has expired");
  }

  verificationAttempts.delete(cleanPhone);

  await db.delete(otps).where(eq(otps.id, otpData.id));

  return true;
};
