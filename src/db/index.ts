// backend/src/db/index.ts

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { logger } from '../utils/logger';

// Connection pool configuration for production
const connectionConfig = {
  max: 20,                      // Maximum number of connections
  idle_timeout: 20,             // Close idle connections after 20 seconds
  connect_timeout: 15,          // Connection timeout in seconds
  max_lifetime: 60 * 30,        // Max lifetime of a connection (30 minutes)
  prepare: false,               // Disable prepared statements for better compatibility
  debug: process.env.NODE_ENV === 'development',
  onnotice: () => {},           // Ignore notice messages
  // Retry configuration
  retry: {
    attempts: 5,
    delay: (attemptNumber: number) => Math.min(1000 * 2 ** attemptNumber, 30000),
  },
};

// Validate database URL
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Main write database with retry support
let writeClient: ReturnType<typeof postgres>;

try {
  writeClient = postgres(process.env.DATABASE_URL!, connectionConfig);
  logger.info('✅ Database client initialized successfully');
} catch (error) {
  logger.error('❌ Failed to initialize database client:', error);
  throw error;
}

// Read replica for analytics (if available)
let readClient: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_READ_URL) {
  try {
    readClient = postgres(process.env.DATABASE_READ_URL, connectionConfig);
    logger.info('✅ Read replica configured');
  } catch (error) {
    logger.warn('⚠️ Failed to configure read replica:', error);
    readClient = null;
  }
}

// Export appropriate db instances
export const db = drizzle(writeClient, { schema });
export const dbRead = readClient ? drizzle(readClient, { schema }) : db;

// ============================================
// HEALTH CHECK FUNCTIONS
// ============================================

/**
 * Check database health with timeout
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    // Use a timeout to avoid hanging
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), 5000);
    });
    
    const queryPromise = writeClient`SELECT 1`;
    
    await Promise.race([queryPromise, timeoutPromise]);
    return true;
  } catch (error) {
    logger.error('❌ Database health check failed:', error);
    return false;
  }
}

/**
 * Check database health with detailed response
 */
export async function getDatabaseStatus(): Promise<{
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await writeClient`SELECT 1`;
    const latency = Date.now() - start;
    return { status: 'healthy', latency };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get connection pool stats - FIXED: removed the conditional that was causing TS error
 */
export function getPoolStats() {
  // Since writeClient is always defined (we throw if it fails),
  // we can return status without conditional
  return {
    writePool: {
      status: 'connected',
    },
    readPool: readClient ? {
      status: 'connected',
    } : null,
  };
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

/**
 * Close database connections gracefully
 */
export async function closeDatabaseConnections(): Promise<void> {
  logger.info('📦 Closing database connections...');
  
  const closePromises: Promise<void>[] = [];
  
  if (writeClient) {
    closePromises.push(
      writeClient.end().then(() => {
        logger.info('✅ Write database connection closed');
      }).catch((error) => {
        logger.error('❌ Error closing write database connection:', error);
      })
    );
  }
  
  if (readClient) {
    closePromises.push(
      readClient.end().then(() => {
        logger.info('✅ Read database connection closed');
      }).catch((error) => {
        logger.error('❌ Error closing read database connection:', error);
      })
    );
  }
  
  await Promise.allSettled(closePromises);
  logger.info('✅ All database connections closed');
}

// ============================================
// TRANSACTION HELPERS
// ============================================

/**
 * Execute a transaction with retry on deadlock
 */
export async function withTransaction<T>(
  callback: (tx: typeof db) => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      return await db.transaction(async (tx) => {
        return await callback(tx);
      });
    } catch (error: any) {
      // Check if it's a deadlock or serialization error
      const isRetryable = error?.message?.includes('deadlock') || 
                          error?.message?.includes('serialization') ||
                          error?.code === '40001' ||
                          error?.code === '40P01';
      
      if (isRetryable && attempt < maxRetries - 1) {
        attempt++;
        const delay = Math.min(100 * 2 ** attempt, 1000);
        logger.warn(`🔄 Transaction retry ${attempt}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw new Error(`Transaction failed after ${maxRetries} attempts`);
}

/**
 * Execute query with connection error handling
 */
export async function safeQuery<T>(
  queryFn: () => Promise<T>,
  fallbackValue?: T
): Promise<T | undefined> {
  try {
    return await queryFn();
  } catch (error: any) {
    // Check if it's a connection error
    const isConnectionError = error?.code === 'ECONNRESET' ||
                             error?.code === 'ECONNREFUSED' ||
                             error?.message?.includes('connection') ||
                             error?.code === '57P01';
    
    if (isConnectionError) {
      logger.warn('⚠️ Database connection error, retrying...');
      // Wait and retry once
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        return await queryFn();
      } catch (retryError) {
        logger.error('❌ Database retry failed:', retryError);
        return fallbackValue;
      }
    }
    
    logger.error('❌ Database query error:', error);
    return fallbackValue;
  }
}

// ============================================
// EXPORT TYPES
// ============================================

export type DbClient = typeof db;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];