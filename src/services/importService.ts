/**
 * Monthly import: parsed workbook -> period, attendance rows, and the two
 * review queues.
 *
 * The two queues solve different problems and are never merged:
 *   - UnmatchedBlock  - punch data exists, but it cannot be attributed.
 *   - ZeroPunchReview - the employee is known and active, but has no data.
 *
 * Re-importing a corrected file updates only the raw punch fields. Human
 * resolutions already recorded against a day are left untouched.
 */

import { db, dbReady } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { daysInMonth, isoDate, makeDate } from '@/domain/time';
import type { ParseResult, ParsedDay, ParsedEmployeeBlock } from '@/import/parseBiometricXls';
import { isSalariedFor } from '@/domain/pay';
import { toRateHistory } from '@/services/payrollService';

export interface ImportOptions {
  year: number;
  month: number;
  fileName: string;
  fileHash: string;
  userId: string | null;
  parsed: ParseResult;
}

export interface NameMismatch {
  deviceId: string;
  nameInFile: string;
  nameOnRecord: string;
}

export interface ImportSummary {
  periodId: string;
  importBatchId: string;
  blocksTotal: number;
  matched: number;
  unmatched: number;
  daysCreated: number;
  daysUpdated: number;
  zeroPunchEmployees: number;
  nameMismatches: NameMismatch[];
  warnings: string[];
}

function normaliseName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z]/g, '');
}

function hasAnyPunch(block: ParsedEmployeeBlock): boolean {
  return block.days.some((day) => day.inMinutes != null || day.outMinutes != null);
}

export class PeriodLockedError extends Error {
  constructor(year: number, month: number) {
    super(`Payroll period ${month}/${year} is locked. An Admin must reopen it before importing.`);
    this.name = 'PeriodLockedError';
  }
}

export async function importParsedWorkbook(options: ImportOptions): Promise<ImportSummary> {
  // Thousands of rows are about to be written; make sure the connection is in
  // WAL before the first one rather than after.
  await dbReady;

  const { year, month, parsed, userId } = options;
  const warnings = [...parsed.warnings];

  // --- is this file actually this month? -----------------------------------
  // Only day numbers are imported, so a file for a 31-day month loaded into a
  // 30-day period would drop day 31 without a word. These two checks are the
  // difference between that and being told.
  const monthLength = daysInMonth(year, month);
  if (parsed.maxDay > monthLength) {
    warnings.push(
      `The file carries ${parsed.maxDay} days but ${month}/${year} has ${monthLength}. Day ${monthLength + 1} onwards was ignored - check you have selected the right period.`,
    );
  }
  if (parsed.detectedPeriod && (parsed.detectedPeriod.year !== year || parsed.detectedPeriod.month !== month)) {
    warnings.push(
      `The report header reads ${parsed.detectedPeriod.month}/${parsed.detectedPeriod.year} but this is the ${month}/${year} period. Confirm before approving.`,
    );
  }
  if (parsed.shiftCodes.length > 0) {
    warnings.push(
      `Device shift labels in this file: ${parsed.shiftCodes.join(', ')}. These are the device's own roster names and are not what pay is calculated against - each employee is paid on the schedule set against their record.`,
    );
  }

  // --- period --------------------------------------------------------------
  let period = await db.payrollPeriod.findUnique({ where: { year_month: { year, month } } });

  if (period?.status === 'LOCKED') throw new PeriodLockedError(year, month);

  if (!period) {
    period = await db.payrollPeriod.create({ data: { year, month } });
    await recordAudit({
      userId,
      action: 'PERIOD_CREATE',
      entityType: 'PayrollPeriod',
      entityId: period.id,
      periodId: period.id,
      newValue: `${month}/${year}`,
    });
  }

  const duplicate = await db.importBatch.findFirst({
    where: { periodId: period.id, fileHash: options.fileHash },
  });
  if (duplicate) {
    warnings.push(
      `This exact file was already imported into this period on ${isoDate(duplicate.uploadedAt)}. Re-importing refreshes punch data but keeps existing resolutions.`,
    );
  }

  const batch = await db.importBatch.create({
    data: {
      periodId: period.id,
      fileName: options.fileName,
      fileHash: options.fileHash,
      uploadedById: userId,
      sheetSummary: JSON.stringify(parsed.sheets),
      warnings: JSON.stringify(warnings),
      blockCount: parsed.employees.length,
    },
  });

  // --- match ---------------------------------------------------------------
  const employees = await db.employee.findMany({
    where: { deviceId: { not: null } },
    select: { id: true, deviceId: true, name: true },
  });
  const byDeviceId = new Map(employees.map((e) => [e.deviceId!, e]));

  const lastDay = daysInMonth(year, month);
  const nameMismatches: NameMismatch[] = [];

  interface PendingDay {
    employeeId: string;
    date: Date;
    dayOfMonth: number;
    statusRaw: string | null;
    status: string;
    rawInMinutes: number | null;
    rawOutMinutes: number | null;
    deviceDurationRaw: string | null;
    deviceShiftRaw: string | null;
  }

  const pending: PendingDay[] = [];
  let matched = 0;
  let unmatched = 0;

  for (const block of parsed.employees) {
    const employee = byDeviceId.get(block.deviceId);

    if (!employee) {
      unmatched += 1;

      // Re-importing must not stack up duplicate queue items for the same
      // device. Refresh the pending one if it is already there, and leave any
      // already-resolved block alone.
      const queued = await db.unmatchedBlock.findFirst({
        where: { periodId: period.id, deviceId: block.deviceId, status: 'PENDING' },
      });

      const data = {
        sheetName: block.sheetName,
        rowIndex: block.rowIndex,
        name: block.name,
        rawDays: JSON.stringify(block.days),
        importBatchId: batch.id,
      };

      if (queued) {
        await db.unmatchedBlock.update({ where: { id: queued.id }, data });
      } else {
        const alreadyResolved = await db.unmatchedBlock.findFirst({
          where: { periodId: period.id, deviceId: block.deviceId, status: { not: 'PENDING' } },
        });
        if (!alreadyResolved) {
          await db.unmatchedBlock.create({
            data: { ...data, periodId: period.id, deviceId: block.deviceId },
          });
        }
      }
      continue;
    }

    // Device ID is the primary key; the name is only a secondary check, so a
    // mismatch is surfaced rather than allowed to block the match.
    if (normaliseName(employee.name) !== normaliseName(block.name)) {
      nameMismatches.push({
        deviceId: block.deviceId,
        nameInFile: block.name,
        nameOnRecord: employee.name,
      });
    }

    matched += 1;

    // A row is written for every calendar day, not only the ones the file
    // carried. Without that, a day the export omitted would have no record to
    // flag or resolve against.
    const parsedByDay = new Map(block.days.map((day) => [day.day, day]));

    for (let dayOfMonth = 1; dayOfMonth <= lastDay; dayOfMonth += 1) {
      const day = parsedByDay.get(dayOfMonth);
      pending.push({
        employeeId: employee.id,
        date: makeDate(year, month, dayOfMonth),
        dayOfMonth,
        statusRaw: day?.statusRaw ?? null,
        status: day?.status ?? 'UNKNOWN',
        rawInMinutes: day?.inMinutes ?? null,
        rawOutMinutes: day?.outMinutes ?? null,
        deviceDurationRaw: day?.deviceDurationRaw ?? null,
        deviceShiftRaw: day?.deviceShiftRaw ?? null,
      });
    }
  }

  for (const mismatch of nameMismatches) {
    warnings.push(
      `Device ID ${mismatch.deviceId} is "${mismatch.nameInFile}" in the file but "${mismatch.nameOnRecord}" on record. Matched on Device ID - confirm it is the same person.`,
    );
  }

  // --- write attendance ----------------------------------------------------
  const existing = await db.attendanceDay.findMany({
    where: { periodId: period.id },
    select: { id: true, employeeId: true, date: true },
  });
  const existingByKey = new Map(
    existing.map((row) => [`${row.employeeId}|${row.date.getTime()}`, row.id]),
  );

  const toCreate = pending.filter(
    (row) => !existingByKey.has(`${row.employeeId}|${row.date.getTime()}`),
  );
  const toUpdate = pending.filter((row) =>
    existingByKey.has(`${row.employeeId}|${row.date.getTime()}`),
  );

  if (toCreate.length > 0) {
    await db.attendanceDay.createMany({
      data: toCreate.map((row) => ({ ...row, periodId: period.id })),
    });
  }

  for (const row of toUpdate) {
    await db.attendanceDay.update({
      where: { id: existingByKey.get(`${row.employeeId}|${row.date.getTime()}`)! },
      // Raw punch fields only - never the human resolution recorded on this day.
      data: {
        statusRaw: row.statusRaw,
        status: row.status,
        rawInMinutes: row.rawInMinutes,
        rawOutMinutes: row.rawOutMinutes,
        deviceDurationRaw: row.deviceDurationRaw,
        deviceShiftRaw: row.deviceShiftRaw,
      },
    });
  }

  // --- zero-punch reconciliation ------------------------------------------
  const blocksWithPunches = new Set(
    parsed.employees.filter(hasAnyPunch).map((block) => block.deviceId),
  );

  const expected = await db.employee.findMany({
    where: { status: 'ACTIVE', scheduleType: { not: 'EXCEPTION' } },
    select: { id: true, deviceId: true, rates: true },
  });

  // A salaried person with no punches is normal, not a question to answer:
  // their pay does not depend on the device, and many never use it.
  const zeroPunch = expected.filter(
    (employee) =>
      !isSalariedFor(toRateHistory(employee.rates), year, month) &&
      (employee.deviceId == null || !blocksWithPunches.has(employee.deviceId)),
  );

  for (const employee of zeroPunch) {
    await db.zeroPunchReview.upsert({
      where: { periodId_employeeId: { periodId: period.id, employeeId: employee.id } },
      create: { periodId: period.id, employeeId: employee.id },
      update: {},
    });
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { matchedCount: matched, warnings: JSON.stringify(warnings) },
  });

  await recordAudit({
    userId,
    action: 'IMPORT',
    entityType: 'ImportBatch',
    entityId: batch.id,
    periodId: period.id,
    newValue: {
      fileName: options.fileName,
      blocks: parsed.employees.length,
      matched,
      unmatched,
      zeroPunch: zeroPunch.length,
    },
  });

  return {
    periodId: period.id,
    importBatchId: batch.id,
    blocksTotal: parsed.employees.length,
    matched,
    unmatched,
    daysCreated: toCreate.length,
    daysUpdated: toUpdate.length,
    zeroPunchEmployees: zeroPunch.length,
    nameMismatches,
    warnings,
  };
}

/**
 * Write a resolved unmatched block's punches onto the employee it was mapped to.
 *
 * The raw days were stored on the block at import time, so resolving the queue
 * does not need the file uploading again. Existing rows are refreshed in their
 * raw fields only - any review already recorded against a day survives.
 */
export async function applyUnmatchedBlock(
  blockId: string,
  employeeId: string,
): Promise<{ created: number; updated: number }> {
  const block = await db.unmatchedBlock.findUniqueOrThrow({ where: { id: blockId } });
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: block.periodId } });

  let days: ParsedDay[] = [];
  try {
    days = JSON.parse(block.rawDays) as ParsedDay[];
  } catch {
    return { created: 0, updated: 0 };
  }

  const byDay = new Map(days.map((day) => [day.day, day]));
  const lastDay = daysInMonth(period.year, period.month);

  const existing = await db.attendanceDay.findMany({
    where: { periodId: period.id, employeeId },
    select: { id: true, date: true },
  });
  const existingByTime = new Map(existing.map((row) => [row.date.getTime(), row.id]));

  const toCreate: {
    periodId: string;
    employeeId: string;
    date: Date;
    dayOfMonth: number;
    statusRaw: string | null;
    status: string;
    rawInMinutes: number | null;
    rawOutMinutes: number | null;
    deviceDurationRaw: string | null;
    deviceShiftRaw: string | null;
  }[] = [];
  let updated = 0;

  for (let dayOfMonth = 1; dayOfMonth <= lastDay; dayOfMonth += 1) {
    const day = byDay.get(dayOfMonth);
    const date = makeDate(period.year, period.month, dayOfMonth);
    const raw = {
      statusRaw: day?.statusRaw ?? null,
      status: day?.status ?? 'UNKNOWN',
      rawInMinutes: day?.inMinutes ?? null,
      rawOutMinutes: day?.outMinutes ?? null,
      deviceDurationRaw: day?.deviceDurationRaw ?? null,
      deviceShiftRaw: day?.deviceShiftRaw ?? null,
    };

    const id = existingByTime.get(date.getTime());
    if (id) {
      await db.attendanceDay.update({ where: { id }, data: raw });
      updated += 1;
    } else {
      toCreate.push({ periodId: period.id, employeeId, date, dayOfMonth, ...raw });
    }
  }

  if (toCreate.length > 0) await db.attendanceDay.createMany({ data: toCreate });

  return { created: toCreate.length, updated };
}
