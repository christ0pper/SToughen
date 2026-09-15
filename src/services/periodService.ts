/**
 * Payroll period lifecycle: prepare -> lock (Admin) -> reopen (Admin) -> re-lock.
 *
 * Locking snapshots the ESI threshold in force at the time, so a reopened
 * period recalculates against the same settings it was originally approved on.
 */

import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { getEsiWageThreshold } from '@/lib/settings';
import { calculatePeriod, checkReadiness } from './payrollService';

export class PeriodLockedError extends Error {
  constructor(message = 'This payroll period is locked. An Admin must reopen it first.') {
    super(message);
    this.name = 'PeriodLockedError';
  }
}

export class NotReadyError extends Error {
  blockers: string[];
  constructor(blockers: string[]) {
    super(`This period is not ready to lock:\n- ${blockers.join('\n- ')}`);
    this.name = 'NotReadyError';
    this.blockers = blockers;
  }
}

/** Call before any mutation that would change a period's numbers. */
export async function assertPeriodEditable(periodId: string): Promise<void> {
  const period = await db.payrollPeriod.findUniqueOrThrow({
    where: { id: periodId },
    select: { status: true },
  });
  if (period.status === 'LOCKED') throw new PeriodLockedError();
}

export interface LockOptions {
  /** Lock despite outstanding queue items. Requires a note explaining why. */
  force?: boolean;
  note?: string;
}

export async function lockPeriod(
  periodId: string,
  userId: string,
  options: LockOptions = {},
): Promise<void> {
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  if (period.status === 'LOCKED') throw new PeriodLockedError('This period is already locked.');

  const readiness = await checkReadiness(periodId);
  if (!readiness.ready) {
    if (!options.force) throw new NotReadyError(readiness.blockers);
    if (!options.note?.trim()) {
      throw new NotReadyError([
        ...readiness.blockers,
        'Locking with outstanding items requires a note.',
      ]);
    }
  }

  // Recalculate immediately before locking, so the stored numbers match the
  // inputs as they stand at sign-off.
  await calculatePeriod(periodId, userId);

  const threshold = period.esiWageThreshold ?? (await getEsiWageThreshold());

  await db.payrollPeriod.update({
    where: { id: periodId },
    data: {
      status: 'LOCKED',
      lockedAt: new Date(),
      lockedById: userId,
      esiWageThreshold: threshold,
    },
  });

  await recordAudit({
    userId,
    action: 'PERIOD_LOCK',
    entityType: 'PayrollPeriod',
    entityId: periodId,
    periodId,
    oldValue: 'DRAFT',
    newValue: 'LOCKED',
    note: options.force
      ? `Locked with outstanding items. ${options.note}`
      : (options.note ?? null),
  });
}

/**
 * Reopen for correction. A reason is required - the spec lists it as a
 * desirable complement to the field-level log, and it costs the Admin one line.
 */
export async function reopenPeriod(
  periodId: string,
  userId: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new Error('A reason is required to reopen a locked period.');

  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  if (period.status !== 'LOCKED') throw new Error('This period is not locked.');

  await db.payrollPeriod.update({
    where: { id: periodId },
    data: {
      status: 'DRAFT',
      reopenedAt: new Date(),
      reopenCount: { increment: 1 },
    },
  });

  await recordAudit({
    userId,
    action: 'PERIOD_REOPEN',
    entityType: 'PayrollPeriod',
    entityId: periodId,
    periodId,
    oldValue: 'LOCKED',
    newValue: 'DRAFT',
    note: reason,
  });
}

export interface DeletedPeriodSummary {
  year: number;
  month: number;
  attendanceDays: number;
  payrollLines: number;
  imports: number;
  auditEntries: number;
}

/**
 * Deletes a month's payroll outright: its imports, attendance, review queues,
 * bonuses, one-off deductions, calculated lines and its audit trail. Employees,
 * their rates and recurring deductions are not touched - they belong to people,
 * not to a month - so the month can be started again from a fresh upload.
 *
 * A locked period is approved payroll and has to be reopened first, which puts
 * a reason on record before anything can be removed.
 */
export async function deletePeriod(periodId: string, userId: string): Promise<DeletedPeriodSummary> {
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  if (period.status === 'LOCKED') {
    throw new PeriodLockedError('This period is approved and locked. Reopen it before deleting it.');
  }

  const [attendanceDays, payrollLines, imports, auditEntries] = await Promise.all([
    db.attendanceDay.count({ where: { periodId } }),
    db.payrollLine.count({ where: { periodId } }),
    db.importBatch.count({ where: { periodId } }),
    db.auditLog.count({ where: { periodId } }),
  ]);

  // Every other table cascades from the period. Audit entries only point at it
  // optionally, so they would survive with the link cleared - delete them first.
  await db.$transaction([
    db.auditLog.deleteMany({ where: { periodId } }),
    db.payrollPeriod.delete({ where: { id: periodId } }),
  ]);

  const summary = { year: period.year, month: period.month, attendanceDays, payrollLines, imports, auditEntries };

  // One line outside the deleted trail, so it is still visible that a month
  // existed and who removed it.
  await recordAudit({
    userId,
    action: 'PERIOD_DELETE',
    entityType: 'PayrollPeriod',
    entityId: periodId,
    periodId: null,
    oldValue: `${period.month}/${period.year} (${period.status})`,
    newValue: summary,
  });

  return summary;
}

export async function getOrCreatePeriod(year: number, month: number, userId: string | null) {
  const existing = await db.payrollPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return existing;

  const created = await db.payrollPeriod.create({ data: { year, month } });
  await recordAudit({
    userId,
    action: 'PERIOD_CREATE',
    entityType: 'PayrollPeriod',
    entityId: created.id,
    periodId: created.id,
    newValue: `${month}/${year}`,
  });
  return created;
}
