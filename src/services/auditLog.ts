// backend/src/services/auditLog.ts
import { db } from "../db";
import { auditLogs, users, userAccounts, mistriAccounts } from "../db/schema";
import { and, eq, desc, gte, lt, SQL } from "drizzle-orm";
import { logger } from "../utils/logger";

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

// ============================================
// HELPERS
// ============================================

/**
 * Get user's full name from the appropriate table
 */
async function getUserName(userId: string): Promise<string | null> {
  try {
    // Check admin users
    const admin = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });
    if (admin) return admin.fullName;

    // Check mistri accounts
    const mistri = await db.query.mistriAccounts.findFirst({
      where: eq(mistriAccounts.id, userId)
    });
    if (mistri) return mistri.fullName;

    // Check user accounts
    const user = await db.query.userAccounts.findFirst({
      where: eq(userAccounts.id, userId)
    });
    if (user) return user.fullName;

    return null;
  } catch (error) {
    logger.error(`Error getting user name for ${userId}:`, error);
    return null;
  }
}

/**
 * Get user's account type from the appropriate table
 */
async function getUserAccountType(userId: string): Promise<'user' | 'mistri' | 'admin' | null> {
  try {
    const admin = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });
    if (admin) return 'admin';

    const mistri = await db.query.mistriAccounts.findFirst({
      where: eq(mistriAccounts.id, userId)
    });
    if (mistri) return 'mistri';

    const user = await db.query.userAccounts.findFirst({
      where: eq(userAccounts.id, userId)
    });
    if (user) return 'user';

    return null;
  } catch (error) {
    logger.error(`Error getting account type for ${userId}:`, error);
    return null;
  }
}

// ============================================
// CREATE AUDIT LOG
// ============================================

/**
 * Create an audit log entry
 * Note: Audit logging should never break business logic, so we catch and log errors
 */
export const createAuditLog = async (entry: AuditLogEntry): Promise<void> => {
  try {
    // Validate the role matches the user's actual role
    let validRole = entry.performedByRole;
    
    if (entry.performedBy && entry.performedBy.length === 36) {
      const actualRole = await getUserAccountType(entry.performedBy);
      if (actualRole && actualRole !== entry.performedByRole) {
        logger.warn(
          `Role mismatch for user ${entry.performedBy}: ` +
          `expected ${entry.performedByRole}, actual ${actualRole}`
        );
        validRole = actualRole;
      }
    }

    await db.insert(auditLogs).values({
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      performedBy: entry.performedBy,
      performedByRole: validRole,
      oldValue: entry.oldValue || null,
      newValue: entry.newValue || null,
      metadata: entry.metadata || null,
    });

    logger.debug(`Audit log created: ${entry.action} on ${entry.entityType} ${entry.entityId}`);
  } catch (error) {
    logger.error('Failed to create audit log:', error);
    // Don't throw - audit logging should never break business logic
  }
};

// ============================================
// GET AUDIT LOGS
// ============================================

/**
 * Get audit logs for a specific entity
 */
export const getAuditLogs = async (
  entityType: string, 
  entityId: string,
  limit: number = 50,
  offset: number = 0
) => {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, entityType),
          eq(auditLogs.entityId, entityId)
        )
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Enrich with user names
    const logsWithNames = await Promise.all(
      logs.map(async (log) => {
        const userName = await getUserName(log.performedBy);
        return {
          ...log,
          performedByName: userName || 'Unknown User',
        };
      })
    );

    // Get total count
    const totalResult = await db
      .select({ count: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, entityType),
          eq(auditLogs.entityId, entityId)
        )
      );

    return {
      logs: logsWithNames,
      pagination: {
        limit,
        offset,
        total: totalResult.length,
      },
    };
  } catch (error) {
    logger.error('Error fetching audit logs:', error);
    throw error;
  }
};

/**
 * Get audit logs for a specific user (all actions performed by them)
 */
export const getUserAuditLogs = async (
  userId: string, 
  limit: number = 50,
  offset: number = 0
) => {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.performedBy, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const logsWithNames = await Promise.all(
      logs.map(async (log) => {
        const userName = await getUserName(log.performedBy);
        return {
          ...log,
          performedByName: userName || 'Unknown User',
        };
      })
    );

    const totalResult = await db
      .select({ count: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.performedBy, userId));

    return {
      logs: logsWithNames,
      pagination: {
        limit,
        offset,
        total: totalResult.length,
      },
    };
  } catch (error) {
    logger.error('Error fetching user audit logs:', error);
    throw error;
  }
};

/**
 * Get recent audit logs with filters
 */
export const getRecentAuditLogs = async (options: {
  limit?: number;
  offset?: number;
  entityType?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
} = {}) => {
  try {
    const { limit = 20, offset = 0, entityType, action, startDate, endDate } = options;

    const conditions: SQL[] = [];

    if (entityType) {
      conditions.push(eq(auditLogs.entityType, entityType));
    }
    if (action) {
      conditions.push(eq(auditLogs.action, action));
    }
    if (startDate) {
      conditions.push(gte(auditLogs.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lt(auditLogs.createdAt, endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const logsWithNames = await Promise.all(
      logs.map(async (log) => {
        const userName = await getUserName(log.performedBy);
        return {
          ...log,
          performedByName: userName || 'Unknown User',
        };
      })
    );

    const totalResult = await db
      .select({ count: auditLogs.id })
      .from(auditLogs)
      .where(whereClause);

    return {
      logs: logsWithNames,
      pagination: {
        limit,
        offset,
        total: totalResult.length,
      },
    };
  } catch (error) {
    logger.error('Error fetching recent audit logs:', error);
    throw error;
  }
};

/**
 * Get audit log summary statistics
 */
export const getAuditLogSummary = async (days: number = 7) => {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, startDate));

    const summary = {
      total: logs.length,
      byAction: {} as Record<string, number>,
      byEntityType: {} as Record<string, number>,
      byDay: {} as Record<string, number>,
      topUsers: {} as Record<string, number>,
    };

    for (const log of logs) {
      // Count by action
      summary.byAction[log.action] = (summary.byAction[log.action] || 0) + 1;

      // Count by entity type
      summary.byEntityType[log.entityType] = (summary.byEntityType[log.entityType] || 0) + 1;

      // Count by day
      const day = log.createdAt.toISOString().split('T')[0];
      summary.byDay[day] = (summary.byDay[day] || 0) + 1;

      // Count by user
      summary.topUsers[log.performedBy] = (summary.topUsers[log.performedBy] || 0) + 1;
    }

    return summary;
  } catch (error) {
    logger.error('Error getting audit log summary:', error);
    throw error;
  }
};

/**
 * Delete old audit logs (cleanup)
 */
export const deleteOldAuditLogs = async (olderThan: Date): Promise<number> => {
  try {
    const result = await db
      .delete(auditLogs)
      .where(lt(auditLogs.createdAt, olderThan))
      .returning({ id: auditLogs.id });

    const deletedCount = result.length;
    logger.info(`Deleted ${deletedCount} old audit logs`);
    return deletedCount;
  } catch (error) {
    logger.error('Error deleting old audit logs:', error);
    throw error;
  }
};