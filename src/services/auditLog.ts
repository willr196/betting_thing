import { prisma } from './database.js';
import { logger } from '../logger.js';

// =============================================================================
// ADMIN AUDIT LOG SERVICE
// =============================================================================

export type AuditAction =
  | 'CREATE_EVENT'
  | 'LOCK_EVENT'
  | 'SETTLE_EVENT'
  | 'CANCEL_EVENT'
  | 'CREATE_REWARD'
  | 'UPDATE_REWARD'
  | 'FULFIL_REDEMPTION'
  | 'CANCEL_REDEMPTION'
  | 'CREDIT_TOKENS'
  | 'REPAIR_BALANCE'
  | 'TRIGGER_SETTLEMENT'
  | 'TRIGGER_ODDS_SYNC';

export type AuditTargetType = 'EVENT' | 'USER' | 'REDEMPTION' | 'REWARD' | 'SYSTEM';

export interface AuditLogEntry {
  adminId: string;
  action: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  details?: Record<string, unknown>;
}

export const AuditLogService = {
  /**
   * Record an admin action. Fire-and-forget — never throws, so it
   * cannot block the primary operation.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.adminAuditLog.create({
        data: {
          adminId: entry.adminId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          details: entry.details as object | undefined,
        },
      });
    } catch (error) {
      // Log the failure but do not propagate — audit logging must not break the primary operation.
      logger.error({ err: error, entry }, 'Failed to write audit log entry');
    }
  },
};
