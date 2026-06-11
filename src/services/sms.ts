// src/services/sms.ts
import { smsQueue } from './queueService';
import { db } from '../db';
import { smsLogs } from '../db/schema';
import { logger } from '../utils/logger';

// Direct send function (for critical OTPs that need immediate delivery)
export async function sendSmsImmediate(phone: string, message: string, type: string): Promise<boolean> {
  const startTime = Date.now();
  
  try {
    // Import SMS provider dynamically
    const { sendSms: sendSmsProvider, checkSparrowBalance } = await import('./smsProvider');
    
    // Check balance in production
    if (process.env.NODE_ENV === 'production') {
      const balance = await checkSparrowBalance();
      if (balance !== null && balance < 1) {
        logger.error(`Low SMS balance: ${balance} credits remaining`);
        // Still try to send, but log warning
      }
    }
    
    const result = await sendSmsProvider(phone, message);
    
    // Log success/failure to database
    await db.insert(smsLogs).values({
      to: phone,
      type: type as any,
      status: result ? 'success' : 'failed',
    });
    
    const duration = Date.now() - startTime;
    logger.info(`SMS ${result ? 'sent' : 'failed'} to ${phone} in ${duration}ms`, { type });
    
    return result;
  } catch (error) {
    // Log failure
    await db.insert(smsLogs).values({
      to: phone,
      type: type as any,
      status: 'failed',
    });
    
    logger.error(`SMS failed for ${phone}:`, error);
    return false;
  }
}

// Queue-based SMS sending (for bulk/non-critical messages)
export async function sendSms(phone: string, message: string, type: string): Promise<void> {
  // Check if queue is available
  if (smsQueue) {
    // Add to queue for background processing
    await smsQueue.add({
      phone,
      message,
      type,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });
    logger.info(`SMS queued for ${phone}`, { type });
  } else {
    // Fallback to immediate send if queue not available
    await sendSmsImmediate(phone, message, type);
  }
}

// Send OTP specifically (with rate limiting)
export async function sendOtpSms(phone: string, otp: string, purpose: string): Promise<boolean> {
  const message = `SERVEX: Your OTP for ${purpose} is: ${otp}. Never share this code with anyone.`;
  return await sendSmsImmediate(phone, message, 'otp_login');
}

// Send bulk SMS (for broadcasts)
export async function sendBulkSms(phones: string[], message: string, type: string): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  
  // Process in batches to avoid overwhelming the API
  const batchSize = 50;
  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((phone: string) => sendSms(phone, message, type))
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        success++;
      } else {
        failed++;
      }
    }
    
    // Small delay between batches
    if (i + batchSize < phones.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  logger.info(`Bulk SMS completed: ${success} success, ${failed} failed`);
  return { success, failed };
}