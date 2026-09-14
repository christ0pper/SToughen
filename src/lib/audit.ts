/**
 * Audit trail.
 *
 * Spec 8.1 step 13 requires that any change made after a period is reopened is
 * captured as who / when / old value -> new value. Locking, reopening and
 * imports are logged too, so a period's whole life is reconstructable.
 */

import { db } from './db';

export type AuditAction =
  | 'PERIOD_CREATE'
  | 'PERIOD_LOCK'
  | 'PERIOD_REOPEN'
  | 'PERIOD_RECALCULATE'
  | 'IMPORT'
  | 'FIELD_UPDATE'
  | 'RESOLVE_FLAG'
  | 'ZERO_PUNCH_DECISION'
  | 'UNMATCHED_RESOLVE'
  | 'RATE_CHANGE'
  | 'DEDUCTION_CREATE'
  | 'DEDUCTION_STOP'
  | 'EXTRA_CREATE'
  | 'EMPLOYEE_CREATE'
  | 'HOLIDAY_CHANGE'
  | 'SETTING_CHANGE';

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string | null;
  periodId?: string | null;
}

function stringify(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      field: entry.field ?? null,
      oldValue: stringify(entry.oldValue),
      newValue: stringify(entry.newValue),
      note: entry.note ?? null,
      periodId: entry.periodId ?? null,
    },
  });
}

/**
 * Diff two shallow records and log one entry per changed field.
 * Used when editing an employee or a resolved day inside a reopened period.
 */
export async function recordFieldChanges(
  base: Omit<AuditEntry, 'field' | 'oldValue' | 'newValue' | 'action'> & { action?: AuditAction },
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<number> {
  const entries: AuditEntry[] = [];

  for (const key of Object.keys(after)) {
    const oldValue = stringify(before[key]);
    const newValue = stringify(after[key]);
    if (oldValue === newValue) continue;
    entries.push({
      ...base,
      action: base.action ?? 'FIELD_UPDATE',
      field: key,
      oldValue,
      newValue,
    });
  }

  for (const entry of entries) await recordAudit(entry);
  return entries.length;
}
