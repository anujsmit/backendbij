import { db } from "../db";
import { auditLogs } from "../db/schema";
import { and, eq, desc } from "drizzle-orm";

export interface AuditLogEntry {
  entityType: string;
  entityId: string;
  action: string;
  performedBy: string;
  performedByRole: 'user' | 'mistri' | 'admin';
  oldValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
}

/**
 * Create an audit log entry
 * Note: Audit logging should never break business logic, so we catch and log errors
 */
export const createAuditLog = async (entry: AuditLogEntry): Promise<void> => {
  try {
    await db.insert(auditLogs).values({
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      performedBy: entry.performedBy,
      performedByRole: entry.performedByRole,
      oldValue: entry.oldValue || null,
      newValue: entry.newValue || null,
      metadata: entry.metadata || null,
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should never break business logic
  }
};

/**
 * Get audit logs for a specific entity
 */
export const getAuditLogs = async (entityType: string, entityId: string) => {
  return await db.select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, entityType),
        eq(auditLogs.entityId, entityId)
      )
    )
    .orderBy(desc(auditLogs.createdAt));
};

/**
 * Get audit logs for a specific user (all actions performed by them)
 */
export const getUserAuditLogs = async (userId: string, limit: number = 50) => {
  return await db.select()
    .from(auditLogs)
    .where(eq(auditLogs.performedBy, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
};
