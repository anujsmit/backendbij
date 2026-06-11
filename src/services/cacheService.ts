import Redis from 'ioredis';
import { logger } from '../utils/logger';

class CacheService {
  private client: Redis | null = null;
  private defaultTTL = 300; // 5 minutes

  constructor() {
    if (process.env.REDIS_URL) {
      this.client = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.client.on('connect', () => {
        logger.info('Redis connected');
      });

      this.client.on('error', (error) => {
        logger.error('Redis error:', error);
      });
    } else {
      logger.warn('REDIS_URL not set, caching disabled');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      logger.error('Cache set error:', error);
    }
  }

  async del(pattern: string): Promise<void> {
    if (!this.client) return;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      logger.error('Cache delete error:', error);
    }
  }

  async clear(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.flushall();
    } catch (error) {
      logger.error('Cache clear error:', error);
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }
}

export const cacheService = new CacheService();