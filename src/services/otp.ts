import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { otps } from "../db/schema";
import { generateOtp } from "../lib/otp";
import { sql } from "drizzle-orm";

const verificationAttempts = new Map<string, { count: number; lastAttempt: number }>();

const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export const createOtp = async (phone: string) => {
  const cleanPhone = phone.replace(/\s+/g, '');

  verificationAttempts.delete(cleanPhone);

  await db.delete(otps).where(eq(otps.phone, cleanPhone));

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(otps).values({ phone: cleanPhone, otp, expiresAt });

  return otp;
};

export const verifyOtp = async (phone: string, otp: string) => {
  const cleanPhone = phone.replace(/\s+/g, '');

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
