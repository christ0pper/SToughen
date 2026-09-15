'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { fail, ok, type ActionState } from '@/lib/actionResult';
import { recordAudit, recordFieldChanges } from '@/lib/audit';
import { requireAdmin, requireUser } from '@/lib/auth';
import { daysInMonth, makeDate } from '@/domain/time';
import { parseBiometricWorkbook } from '@/import/parseBiometricXls';
import { applyUnmatchedBlock, importParsedWorkbook } from '@/services/importService';
import { calculatePeriod } from '@/services/payrollService';
import { periodLabel } from '@/lib/format';
import {
  assertPeriodEditable,
  deletePeriod,
  getOrCreatePeriod,
  lockPeriod,
  reopenPeriod,
} from '@/services/periodService';

export type { ActionState } from '@/lib/actionResult';

export async function createPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const year = Number(formData.get('year'));
    const month = Number(formData.get('month'));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'Enter a valid year.' };
    if (!Number.isInteger(month) || month < 1 || month > 12) return { error: 'Choose a month.' };

    await getOrCreatePeriod(year, month, user.id);
    revalidatePath('/periods');
    return ok(`Period ${month}/${year} is ready.`);
  } catch (error) {
    return fail(error);
  }
}

export async function uploadFileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const file = formData.get('file');
    const year = Number(formData.get('year'));
    const month = Number(formData.get('month'));

    if (!(file instanceof File) || file.size === 0) return { error: 'Choose the monthly .xls export.' };
    if (!Number.isInteger(year) || !Number.isInteger(month)) return { error: 'Confirm the period.' };

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash('sha256').update(bytes).digest('hex');

    const parsed = parseBiometricWorkbook(bytes);
    if (parsed.employees.length === 0) {
      return { error: parsed.warnings[0] ?? 'No employee blocks were found in that file.' };
    }

    if (parsed.detectedPeriod && (parsed.detectedPeriod.year !== year || parsed.detectedPeriod.month !== month)) {
      return {
        error: `The file looks like ${parsed.detectedPeriod.month}/${parsed.detectedPeriod.year} but you selected ${month}/${year}. Confirm the period before importing.`,
      };
    }

    const summary = await importParsedWorkbook({
      year,
      month,
      fileName: file.name,
      fileHash,
      userId: user.id,
      parsed,
    });

    await calculatePeriod(summary.periodId, user.id);

    revalidatePath('/periods');
    revalidatePath(`/periods/${summary.periodId}`);

    // What was READ is the parsing answer, and it is true whether or not anyone
    // matched. Rows only get written for people already on record, so on a first
    // upload "0 attendance days" is accurate and reads like a failure - it is
    // reported only once there is something to report.
    const dayCells = parsed.employees.reduce((total, block) => total + block.days.length, 0);
    const dayRows = summary.daysCreated + summary.daysUpdated;
    const count = (value: number) => value.toLocaleString('en-IN');

    return ok(
      `Read ${summary.blocksTotal} employee block(s) across ${parsed.sheets.length} sheet(s) and recalculated the period.`,
      [
        { label: 'blocks read', value: count(summary.blocksTotal), tone: 'brand' },
        { label: 'day cells read', value: count(dayCells), tone: 'brand' },
        ...(summary.matched > 0
          ? [{ label: 'matched to people', value: count(summary.matched), tone: 'brand' as const }]
          : []),
        ...(dayRows > 0
          ? [{ label: 'attendance rows written', value: count(dayRows), tone: 'brand' as const }]
          : []),
        ...(summary.unmatched > 0
          ? [{ label: 'awaiting a person', value: count(summary.unmatched), tone: 'warn' as const }]
          : []),
        ...(summary.zeroPunchEmployees > 0
          ? [{ label: 'no punches at all', value: count(summary.zeroPunchEmployees), tone: 'warn' as const }]
          : []),
      ],
    );
  } catch (error) {
    return fail(error);
  }
}

export async function recalculateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const periodId = String(formData.get('periodId'));
    await assertPeriodEditable(periodId);
    const summary = await calculatePeriod(periodId, user.id);
    revalidatePath(`/periods/${periodId}`);
    return ok(
      `Recalculated ${summary.linesWritten} employee(s). ${summary.unresolvedFlags} flagged day(s) still unresolved.`,
    );
  } catch (error) {
    return fail(error);
  }
}

export async function lockPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireAdmin();
    const periodId = String(formData.get('periodId'));
    await lockPeriod(periodId, user.id, {
      force: formData.get('force') === 'on',
      note: String(formData.get('note') ?? ''),
    });
    revalidatePath(`/periods/${periodId}`);
    revalidatePath('/periods');
    return ok('Period approved and locked.');
  } catch (error) {
    return fail(error);
  }
}

export async function reopenPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireAdmin();
    const periodId = String(formData.get('periodId'));
    await reopenPeriod(periodId, user.id, String(formData.get('reason') ?? ''));
    revalidatePath(`/periods/${periodId}`);
    revalidatePath('/periods');
    return ok('Period reopened. Every change from here is recorded in the audit trail.');
  } catch (error) {
    return fail(error);
  }
}

export async function deletePeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireAdmin();
    const periodId = String(formData.get('periodId'));
    const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) return { error: 'That period no longer exists.' };

    // Typing the month is the difference between meaning it and a stray click
    // on the wrong period - there is no undo.
    const expected = periodLabel(period.year, period.month);
    const typed = String(formData.get('confirmLabel') ?? '').trim();
    if (typed.toLowerCase() !== expected.toLowerCase()) {
      return { error: `Type "${expected}" exactly to confirm.` };
    }

    await deletePeriod(periodId, user.id);
    revalidatePath('/periods');
    revalidatePath('/dashboard');
  } catch (error) {
    return fail(error);
  }
  // Outside the try: redirect works by throwing, and fail() would swallow it.
  redirect('/periods');
}

export async function resolveDayAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const dayId = String(formData.get('dayId'));

    const existing = await db.attendanceDay.findUniqueOrThrow({ where: { id: dayId } });
    await assertPeriodEditable(existing.periodId);

    const readNumber = (key: string): number => {
      const raw = formData.get(key);
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    };

    const manualRaw = String(formData.get('manualWorkedMinutes') ?? '').trim();
    const tag = String(formData.get('resolutionTag') ?? '').trim() || null;
    const grantOverride = formData.get('grantPunctualityOverride') === 'on';
    const overrideNote = String(formData.get('punctualityOverrideNote') ?? '').trim() || null;

    if (grantOverride && !overrideNote) {
      return { error: 'A note is required to grant the punctuality bonus despite a discrepancy.' };
    }
    if (tag === 'OTHER' && !String(formData.get('resolutionNote') ?? '').trim()) {
      return { error: 'Describe the reason when resolving a day as "Other".' };
    }

    const update = {
      resolutionTag: tag,
      resolutionNote: String(formData.get('resolutionNote') ?? '').trim() || null,
      paidLeaveMinutes: readNumber('paidLeaveMinutes'),
      manualWorkedMinutes: manualRaw === '' ? null : Math.max(0, Math.round(Number(manualRaw))),
      confirmedOtMinutes: readNumber('confirmedOtMinutes'),
      meritTicked: formData.get('meritTicked') === 'on',
      grantPunctualityOverride: grantOverride,
      punctualityOverrideNote: overrideNote,
      resolved: formData.get('resolved') === 'on',
      resolvedAt: new Date(),
      resolvedById: user.id,
    };

    await db.attendanceDay.update({ where: { id: dayId }, data: update });

    // A period that has been reopened is under audit, so log the field diff.
    const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: existing.periodId } });
    if (period.reopenCount > 0) {
      await recordFieldChanges(
        {
          userId: user.id,
          action: 'RESOLVE_FLAG',
          entityType: 'AttendanceDay',
          entityId: dayId,
          periodId: existing.periodId,
        },
        existing as unknown as Record<string, unknown>,
        update as unknown as Record<string, unknown>,
      );
    }

    await calculatePeriod(existing.periodId, user.id);
    revalidatePath(`/periods/${existing.periodId}`);
    return ok('Day updated.');
  } catch (error) {
    return fail(error);
  }
}

export async function zeroPunchDecisionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const reviewId = String(formData.get('reviewId'));
    const decision = String(formData.get('decision'));

    if (!['LEFT_INACTIVE', 'EXTENDED_LEAVE', 'KEEP_ACTIVE'].includes(decision)) {
      return { error: 'Choose how to treat this employee.' };
    }

    const review = await db.zeroPunchReview.findUniqueOrThrow({ where: { id: reviewId } });
    await assertPeriodEditable(review.periodId);

    const returnRaw = String(formData.get('expectedReturnDate') ?? '').trim();
    const expectedReturnDate = returnRaw ? new Date(returnRaw) : null;

    await db.zeroPunchReview.update({
      where: { id: reviewId },
      data: {
        decision,
        expectedReturnDate,
        note: String(formData.get('note') ?? '').trim() || null,
        decidedAt: new Date(),
        decidedById: user.id,
      },
    });

    // The decision also moves the employee's own status.
    if (decision === 'LEFT_INACTIVE') {
      await db.employee.update({
        where: { id: review.employeeId },
        data: { status: 'INACTIVE', leftOn: new Date(), expectedReturnDate: null },
      });
    } else if (decision === 'EXTENDED_LEAVE') {
      await db.employee.update({
        where: { id: review.employeeId },
        data: { status: 'ON_EXTENDED_LEAVE', expectedReturnDate },
      });
    }

    await recordAudit({
      userId: user.id,
      action: 'ZERO_PUNCH_DECISION',
      entityType: 'ZeroPunchReview',
      entityId: reviewId,
      periodId: review.periodId,
      newValue: decision,
    });

    await calculatePeriod(review.periodId, user.id);
    revalidatePath(`/periods/${review.periodId}`);
    return ok('Recorded.');
  } catch (error) {
    return fail(error);
  }
}

/**
 * Creates an employee for every unmatched block in one go.
 *
 * The export carries a device ID and a name and nothing else, so a joining date
 * and a schedule have to come from the operator - and one answer is applied to
 * everyone. That is right for standing a month up quickly to check the file
 * reads; it is not right for payroll, because the schedule decides what counts
 * as late and a shared guess makes some of those judgements wrong. Fix the
 * exceptions on the Employees tab afterwards, before approving anything.
 */
export async function createAllUnmatchedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const periodId = String(formData.get('periodId'));
    await assertPeriodEditable(periodId);

    const scheduleType = String(formData.get('scheduleType') ?? 'PS');
    // Optional: the export does not carry one, and insisting on a made-up date
    // is worse than recording that nobody knows it yet.
    const joiningRaw = String(formData.get('joiningDate') ?? '').trim();
    const joiningDate = joiningRaw ? new Date(joiningRaw) : null;
    if (joiningDate && Number.isNaN(joiningDate.getTime())) {
      return { error: 'That joining date is not a date.' };
    }

    const blocks = await db.unmatchedBlock.findMany({
      where: { periodId, status: 'PENDING' },
      orderBy: { rowIndex: 'asc' },
    });
    if (blocks.length === 0) return { error: 'Nothing waiting in the queue.' };

    // One scan for the highest code in use, then count up locally - asking the
    // database per employee would race itself and collide on the unique code.
    const codes = await db.employee.findMany({ select: { employeeCode: true } });
    let next = codes.reduce((highest, row) => {
      const match = /^EMP-(\d+)$/.exec(row.employeeCode);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);

    const taken = new Set(
      (await db.employee.findMany({ where: { deviceId: { not: null } }, select: { deviceId: true } }))
        .map((row) => row.deviceId as string),
    );

    let created = 0;
    let applied = 0;
    let skipped = 0;

    for (const block of blocks) {
      // A device ID already on someone else is a mapping decision, not a new
      // person - leave it in the queue rather than creating a duplicate.
      if (taken.has(block.deviceId)) {
        skipped += 1;
        continue;
      }

      next += 1;
      const employee = await db.employee.create({
        data: {
          employeeCode: `EMP-${String(next).padStart(4, '0')}`,
          deviceId: block.deviceId,
          name: block.name,
          joiningDate,
          scheduleType,
          exceptionRole: scheduleType === 'EXCEPTION' ? 'MANAGER' : null,
        },
      });
      taken.add(block.deviceId);

      await db.unmatchedBlock.update({
        where: { id: block.id },
        data: {
          status: 'CREATED',
          resolvedEmployeeId: employee.id,
          resolvedAt: new Date(),
          resolvedById: user.id,
        },
      });

      const result = await applyUnmatchedBlock(block.id, employee.id);
      applied += result.created + result.updated;
      created += 1;
    }

    await recordAudit({
      userId: user.id,
      action: 'EMPLOYEE_CREATE',
      entityType: 'Employee',
      entityId: periodId,
      periodId,
      newValue: {
        created,
        skipped,
        scheduleType,
        joiningDate: joiningRaw || '(not set)',
        from: 'bulk create from the unmatched queue',
      },
    });

    // Once, at the end. Recalculating per employee would redo the whole period
    // a hundred times over.
    if (created > 0) await calculatePeriod(periodId, user.id);

    revalidatePath(`/periods/${periodId}`);
    return ok(
      'Created from the file, and the period recalculated.' +
        (skipped > 0 ? ` ${skipped} left in the queue - their device ID is already on someone.` : '') +
        ' Set each persons real schedule and rate before approving.',
      [
        { label: 'people created', value: String(created), tone: 'brand' },
        { label: 'attendance days', value: String(applied), tone: 'brand' },
        ...(skipped > 0
          ? [{ label: 'left in queue', value: String(skipped), tone: 'warn' as const }]
          : []),
      ],
    );
  } catch (error) {
    return fail(error);
  }
}

export async function resolveUnmatchedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const blockId = String(formData.get('blockId'));
    const mode = String(formData.get('mode'));

    const block = await db.unmatchedBlock.findUniqueOrThrow({ where: { id: blockId } });
    await assertPeriodEditable(block.periodId);

    if (mode === 'IGNORE') {
      await db.unmatchedBlock.update({
        where: { id: blockId },
        data: { status: 'IGNORED', resolvedAt: new Date(), resolvedById: user.id },
      });
    } else if (mode === 'MAP') {
      const employeeId = String(formData.get('employeeId') ?? '');
      if (!employeeId) return { error: 'Choose the employee to map this data to.' };

      // Adopting the device ID is what makes future months match automatically.
      await db.employee.update({ where: { id: employeeId }, data: { deviceId: block.deviceId } });
      await db.unmatchedBlock.update({
        where: { id: blockId },
        data: {
          status: 'MAPPED',
          resolvedEmployeeId: employeeId,
          resolvedAt: new Date(),
          resolvedById: user.id,
        },
      });
    } else if (mode === 'CREATE') {
      const name = String(formData.get('name') ?? '').trim() || block.name;
      const scheduleType = String(formData.get('scheduleType') ?? 'PS');
      const joiningRaw = String(formData.get('joiningDate') ?? '').trim();

      if (!joiningRaw) return { error: 'A joining date is required - holiday pay depends on it.' };

      const count = await db.employee.count();
      const created = await db.employee.create({
        data: {
          employeeCode: `EMP-${String(count + 1).padStart(4, '0')}`,
          deviceId: block.deviceId,
          name,
          joiningDate: new Date(joiningRaw),
          scheduleType,
          exceptionRole: scheduleType === 'EXCEPTION' ? String(formData.get('exceptionRole') ?? 'MANAGER') : null,
        },
      });

      await recordAudit({
        userId: user.id,
        action: 'EMPLOYEE_CREATE',
        entityType: 'Employee',
        entityId: created.id,
        periodId: block.periodId,
        newValue: { name, deviceId: block.deviceId, from: 'unmatched row queue' },
      });

      await db.unmatchedBlock.update({
        where: { id: blockId },
        data: {
          status: 'CREATED',
          resolvedEmployeeId: created.id,
          resolvedAt: new Date(),
          resolvedById: user.id,
        },
      });
    } else {
      return { error: 'Unknown action.' };
    }

    await recordAudit({
      userId: user.id,
      action: 'UNMATCHED_RESOLVE',
      entityType: 'UnmatchedBlock',
      entityId: blockId,
      periodId: block.periodId,
      newValue: mode,
    });

    // The block already carries its punch data, so a mapped or newly created
    // employee gets their days straight away - no second upload needed.
    let applied = { created: 0, updated: 0 };
    if (mode !== 'IGNORE') {
      const resolved = await db.unmatchedBlock.findUniqueOrThrow({ where: { id: blockId } });
      if (resolved.resolvedEmployeeId) {
        applied = await applyUnmatchedBlock(blockId, resolved.resolvedEmployeeId);
        await calculatePeriod(block.periodId, user.id);
      }
    }

    revalidatePath(`/periods/${block.periodId}`);
    return ok(
      mode === 'IGNORE'
        ? 'Block ignored.'
        : `Linked. ${applied.created + applied.updated} day(s) of punch data applied and the period recalculated.`,
    );
  } catch (error) {
    return fail(error);
  }
}

/**
 * Exception roles (salesman, manager, security, driver) are paid on manually
 * entered hours. Their punch data, if the device recorded any, is ignored.
 */
export async function saveManualHoursAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const periodId = String(formData.get('periodId'));
    const employeeId = String(formData.get('employeeId'));
    await assertPeriodEditable(periodId);

    const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });

    if (employee.scheduleType !== 'EXCEPTION') {
      return { error: `${employee.name} is punch-based. Manual hours apply to exception roles only.` };
    }

    const lastDay = daysInMonth(period.year, period.month);
    const fillRaw = String(formData.get('fillAll') ?? '').trim();
    const fill = fillRaw === '' ? null : Number(fillRaw);
    if (fill != null && (!Number.isFinite(fill) || fill < 0 || fill > 24)) {
      return { error: 'The fill value must be between 0 and 24 hours.' };
    }

    let entered = 0;

    for (let dayOfMonth = 1; dayOfMonth <= lastDay; dayOfMonth += 1) {
      const date = makeDate(period.year, period.month, dayOfMonth);

      // Sunday is the weekly off, so a blanket fill skips it.
      const raw = String(formData.get(`day-${dayOfMonth}`) ?? '').trim();
      const useFill = fill != null && raw === '' && date.getDay() !== 0;
      const value = useFill ? fill : raw === '' ? null : Number(raw);

      if (value != null && (!Number.isFinite(value) || value < 0 || value > 24)) {
        return { error: `Day ${dayOfMonth}: enter between 0 and 24 hours.` };
      }

      const minutes = value == null ? null : Math.round(value * 60);
      if (minutes != null && minutes > 0) entered += 1;

      await db.attendanceDay.upsert({
        where: { periodId_employeeId_date: { periodId, employeeId, date } },
        create: {
          periodId,
          employeeId,
          date,
          dayOfMonth,
          status: 'UNKNOWN',
          manualWorkedMinutes: minutes,
          resolved: minutes != null,
        },
        update: { manualWorkedMinutes: minutes, resolved: minutes != null },
      });
    }

    await recordAudit({
      userId: user.id,
      action: 'FIELD_UPDATE',
      entityType: 'Employee',
      entityId: employeeId,
      periodId,
      field: 'manualHours',
      newValue: `${entered} day(s) entered`,
    });

    await calculatePeriod(periodId, user.id);
    revalidatePath(`/periods/${periodId}/manual-hours`);
    revalidatePath(`/periods/${periodId}`);
    return ok(`Saved ${entered} day(s) for ${employee.name}.`);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Merit is ticked per employee per day and is not tied to a discrepancy, so it
 * needs its own grid rather than living only on the flagged-day queue.
 */
export async function saveMeritAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const periodId = String(formData.get('periodId'));
    const employeeId = String(formData.get('employeeId'));
    await assertPeriodEditable(periodId);

    const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });

    if (employee.scheduleType === 'EXCEPTION') {
      return { error: 'Merit pay does not apply to exception roles.' };
    }

    const lastDay = daysInMonth(period.year, period.month);
    const tickAll = formData.get('tickAll') === 'on';
    let ticked = 0;

    for (let dayOfMonth = 1; dayOfMonth <= lastDay; dayOfMonth += 1) {
      const date = makeDate(period.year, period.month, dayOfMonth);
      // A blanket tick skips Sundays, which are not working days.
      const value = tickAll ? date.getDay() !== 0 : formData.get(`merit-${dayOfMonth}`) === 'on';
      if (value) ticked += 1;

      await db.attendanceDay.upsert({
        where: { periodId_employeeId_date: { periodId, employeeId, date } },
        create: { periodId, employeeId, date, dayOfMonth, status: 'UNKNOWN', meritTicked: value },
        update: { meritTicked: value },
      });
    }

    await recordAudit({
      userId: user.id,
      action: 'FIELD_UPDATE',
      entityType: 'Employee',
      entityId: employeeId,
      periodId,
      field: 'meritTicked',
      newValue: `${ticked} day(s) ticked`,
    });

    await calculatePeriod(periodId, user.id);
    revalidatePath(`/periods/${periodId}/merit`);
    revalidatePath(`/periods/${periodId}`);
    return ok(`${ticked} merit day(s) recorded for ${employee.name}.`);
  } catch (error) {
    return fail(error);
  }
}
