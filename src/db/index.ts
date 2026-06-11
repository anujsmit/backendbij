import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { logger } from '../utils/logger';

// Connection pool configuration for production
const connectionConfig = {
  max: 20,                      
  idle_timeout: 20,         
  connect_timeout: 10,        
  max_lifetime: 60 * 30,       
  prepare: false,              
  debug: process.env.NODE_ENV === 'development',
  onnotice: () => {},
};

// Main write database
const writeClient = postgres(process.env.DATABASE_URL!, connectionConfig);

// Read replica for analytics (if available)
let readClient: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_READ_URL) {
  readClient = postgres(process.env.DATABASE_READ_URL, connectionConfig);
  logger.info('Read replica configured');
}

// Export appropriate db instances
export const db = drizzle(writeClient, { schema });
export const dbRead = readClient ? drizzle(readClient, { schema }) : db;

// Health check function
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await writeClient`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}

// Graceful shutdown
export async function closeDatabaseConnections(): Promise<void> {
  logger.info('Closing database connections...');
  await writeClient.end();
  if (readClient) await readClient.end();
}