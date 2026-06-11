// src/services/queueService.ts
import { logger } from '../utils/logger';
import { sendSmsImmediate } from './sms';
import { sendPushNotification } from './pushNotificationService';

// Simple in-memory queue for development (no Redis required)
class SimpleQueue {
  private queue: Array<{ data: any; resolve: Function; reject: Function }> = [];
  private isProcessing = false;

  // Dummy on method to prevent errors when code tries to register event listeners
  on(event: string, callback: Function): void {
    // SimpleQueue doesn't support events, just log that it was called in debug mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`SimpleQueue: Event '${event}' registered (ignored - no Redis)`);
    }
  }

  async add(data: any, options?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        try {
          const result = await this.executeJob(item.data);
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      }
    }

    this.isProcessing = false;
  }

  private async executeJob(data: any): Promise<any> {
    // Handle different job types
    if (data.phone && data.message) {
      // SMS job
      return await sendSmsImmediate(data.phone, data.message, data.type);
    } else if (data.tokens && data.title) {
      // Push notification job
      const results = [];
      for (const token of data.tokens) {
        try {
          await sendPushNotification(token, data.title, data.body, data.data);
          results.push({ success: true, token });
        } catch (error) {
          results.push({ success: false, token, error });
        }
      }
      return results;
    }
    return null;
  }

  async getWaitingCount(): Promise<number> { 
    return this.queue.length; 
  }
  
  async getActiveCount(): Promise<number> { 
    return this.isProcessing ? 1 : 0; 
  }
  
  async getCompletedCount(): Promise<number> { 
    return 0; 
  }
  
  async getFailedCount(): Promise<number> { 
    return 0; 
  }
  
  async close(): Promise<void> { 
    this.queue = []; 
    this.isProcessing = false; 
  }
}

// Use Redis if available, otherwise fallback to in-memory queue
let smsQueue: any;
let pushQueue: any;
let emailQueue: any;

// Check if Redis is configured and available
const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL && REDIS_URL !== 'redis://localhost:6379' && REDIS_URL !== '') {
  try {
    const Bull = require('bull');
    smsQueue = new Bull('sms', REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    pushQueue = new Bull('push', REDIS_URL);
    emailQueue = new Bull('email', REDIS_URL);
    logger.info('Redis queues initialized');
  } catch (error) {
    logger.warn('Failed to initialize Redis queues, using in-memory fallback:', error);
    smsQueue = new SimpleQueue();
    pushQueue = new SimpleQueue();
    emailQueue = new SimpleQueue();
  }
} else {
  logger.info('REDIS_URL not configured, using in-memory queues');
  smsQueue = new SimpleQueue();
  pushQueue = new SimpleQueue();
  emailQueue = new SimpleQueue();
}

// Export queues
export { smsQueue, pushQueue, emailQueue };

// Queue statistics helper
export async function getQueueStats(): Promise<any> {
  const getCount = async (queue: any, method: string): Promise<number> => {
    if (queue && typeof queue[method] === 'function') {
      try {
        return await queue[method]();
      } catch (error) {
        return 0;
      }
    }
    return 0;
  };

  return {
    sms: {
      waiting: await getCount(smsQueue, 'getWaitingCount'),
      active: await getCount(smsQueue, 'getActiveCount'),
      completed: await getCount(smsQueue, 'getCompletedCount'),
      failed: await getCount(smsQueue, 'getFailedCount'),
    },
    push: {
      waiting: await getCount(pushQueue, 'getWaitingCount'),
      active: await getCount(pushQueue, 'getActiveCount'),
      completed: await getCount(pushQueue, 'getCompletedCount'),
      failed: await getCount(pushQueue, 'getFailedCount'),
    },
  };
}

// Graceful shutdown
export async function closeQueues(): Promise<void> {
  logger.info('Closing queues...');
  const closeQueue = async (queue: any) => {
    if (queue && typeof queue.close === 'function') {
      try {
        await queue.close();
      } catch (error) {
        logger.error('Error closing queue:', error);
      }
    }
  };
  
  await Promise.all([
    closeQueue(smsQueue),
    closeQueue(pushQueue),
    closeQueue(emailQueue),
  ]);
}