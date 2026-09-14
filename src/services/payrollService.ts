/**
 * Assembles everything the domain engine needs for a period, runs it, and
 * snapshots the result to PayrollLine.
 *
 * Calculation is always derived from stored raw punches plus stored human
 * decisions, so recalculating a reopened period reproduces the same numbers
 * from the same inputs - including the hourly rate that was in force then.
 */

import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { getEsiWageThreshold, getRoundingGrace } from '@/lib/settings';
import { EXCEPTION_ROLE_SCHEDULE, type ExceptionRole, type ScheduleCode } from '@/domain/config';
import { computeDay, dayKey, type GraceMinutes } from '@/domain/hours';
import {
  calculatePayroll,
  isSalariedFor,
  type AmountEntry,
  type PayrollResult,
  type RateHistoryEntry,
} from '@/domain/pay';
import { daysInMonth, makeDate } from '@/domain/time';
import type { DayComputation, DayInput, DayResolution } from '@/domain/types';
import type { AttendanceDay, Employee, EmployeeRate } from '@prisma/client';

/** The schedule used for calculation. Exception roles only reference one. */
export function scheduleFor(employee: Pick<Employee, 'scheduleType' | 'exceptionRole'>): ScheduleCode {
  if (employee.scheduleType === 'EXCEPTION') {
    const role = (employee.exceptionRole ?? 'MANAGER') as ExceptionRole;
    return EXCEPTION_ROLE_SCHEDULE[role] ?? 'OS';
  }
  return employee.scheduleType as ScheduleCode;
}

export function isExceptionRole(employee: Pick<Employee, 'scheduleType'>): boolean {
  return employee.scheduleType === 'EXCEPTION';
}

/** Database rate rows as the pay engine reads them, basis included. */
export function toRateHistory(
  rates: Pick<EmployeeRate, 'effectiveFrom' | 'payBasis' | 'hourlyRate' | 'monthlySalary'>[],
): RateHistoryEntry[] {
  return rates.map((r) => ({
    effectiveFrom: r.effectiveFrom,
    payBasis: r.payBasis === 'MONTHLY' ? 'MONTHLY' : 'HOURLY',
    hourlyRate: r.hourlyRate,
    monthlySalary: r.monthlySalary,
  }));
}

function toResolution(row: AttendanceDay | undefined): DayResolution {
  return {
    tag: (row?.resolutionTag as DayResolution['tag']) ?? null,
    note: row?.resolutionNote ?? null,
    paidLeaveMinutes: row?.paidLeaveMinutes ?? 0,
    manualWorkedMinutes: row?.manualWorkedMinutes ?? null,
    confirmedOtMinutes: row?.confirmedOtMinutes ?? 0,
    meritTicked: row?.meritTicked ?? false,
    grantPunctualityOverride: row?.grantPunctualityOverride ?? false,
    punctualityOverrideNote: row?.punctualityOverrideNote ?? null,
    resolved: row?.resolved ?? false,
  };
}

export interface PeriodContext {
  periodId: string;
  year: number;
  month: number;
  holidays: { date: Date; name: string }[];
  holidayKeys: Set<string>;
  esiWageThreshold: number | null;
  roundingGrace: GraceMinutes;
}

export async function loadPeriodContext(periodId: string): Promise<PeriodContext> {
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const start = makeDate(period.year, period.month, 1);
  const end = makeDate(period.year, period.month, daysInMonth(period.year, period.month));

  const holidays = await db.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: 'asc' },
  });

  return {
    periodId,
    year: period.year,
    month: period.month,
    holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
    holidayKeys: new Set(holidays.map((h) => dayKey(h.date))),
    esiWageThreshold: period.esiWageThreshold ?? (await getEsiWageThreshold()),
    roundingGrace: await getRoundingGrace(),
  };
}

/**
 * Every calendar day of the period, whether or not the file had a row for it.
 * A day missing from the import must still surface as an absence.
 */
export function buildDayComputations(
  context: PeriodContext,
  employee: Employee,
  attendance: AttendanceDay[],
): DayComputation[] {
  const schedule = scheduleFor(employee);
  const byDay = new Map(attendance.map((row) => [row.dayOfMonth, row]));
  const lastDay = daysInMonth(context.year, context.month);
  const results: DayComputation[] = [];

  for (let day = 1; day <= lastDay; day += 1) {
    const date = makeDate(context.year, context.month, day);
    const row = byDay.get(day);
    const input: DayInput = {
      date,
      status: (row?.status as DayInput['status']) ?? 'UNKNOWN',
      rawIn: row?.rawInMinutes ?? null,
      rawOut: row?.rawOutMinutes ?? null,
      isPublicHoliday: context.holidayKeys.has(dayKey(date)),
    };
    results.push(computeDay(input, schedule, toResolution(row), context.roundingGrace));
  }

  return results;
}

async function deductionsFor(
  employeeId: string,
  context: PeriodContext,
): Promise<{ oneOff: AmountEntry[]; recurring: AmountEntry[] }> {
  const start = makeDate(context.year, context.month, 1);
  const end = makeDate(context.year, context.month, daysInMonth(context.year, context.month));

  const rows = await db.deduction.findMany({
    where: {
      employeeId,
      OR: [
        { kind: 'ONE_OFF', periodId: context.periodId },
        {
          kind: 'RECURRING',
          active: true,
          AND: [
            { OR: [{ startDate: null }, { startDate: { lte: end } }] },
            { OR: [{ endDate: null }, { endDate: { gte: start } }] },
          ],
        },
      ],
    },
  });

  return {
    oneOff: rows
      .filter((r) => r.kind === 'ONE_OFF')
      .map((r) => ({ amount: r.amount, reason: r.reason })),
    recurring: rows
      .filter((r) => r.kind === 'RECURRING')
      .map((r) => ({ amount: r.amount, reason: r.reason })),
  };
}

export interface EmployeePeriodDetail {
  employee: Employee;
  days: DayComputation[];
  result: PayrollResult;
  inPayroll: boolean;
  exclusionReason: string | null;
}

export async function calculateEmployee(
  context: PeriodContext,
  employee: Employee,
): Promise<EmployeePeriodDetail> {
  const attendance = await db.attendanceDay.findMany({
    where: { periodId: context.periodId, employeeId: employee.id },
    orderBy: { dayOfMonth: 'asc' },
  });

  const review = await db.zeroPunchReview.findUnique({
    where: { periodId_employeeId: { periodId: context.periodId, employeeId: employee.id } },
  });

  const excluded =
    review?.decision === 'LEFT_INACTIVE' || review?.decision === 'EXTENDED_LEAVE'
      ? review.decision
      : null;

  const rates = await db.employeeRate.findMany({
    where: { employeeId: employee.id },
    orderBy: { effectiveFrom: 'asc' },
  });

  const extras = await db.extraBonus.findMany({
    where: { periodId: context.periodId, employeeId: employee.id },
  });

  const { oneOff, recurring } = await deductionsFor(employee.id, context);
  const rateHistory = toRateHistory(rates);

  // A salary outranks the schedule: a salaried manager is paid their salary, not
  // hand-entered hours, and a salaried plant worker is not paid by the punch.
  const salaried = isSalariedFor(rateHistory, context.year, context.month);
  const exception = !salaried && isExceptionRole(employee);
  const kind = salaried ? 'SALARIED' : exception ? 'EXCEPTION' : 'PUNCH';

  const days = kind === 'PUNCH' ? buildDayComputations(context, employee, attendance) : [];

  const manualDays = exception
    ? attendance
        .filter((row) => row.manualWorkedMinutes != null)
        .map((row) => ({ date: row.date, hours: (row.manualWorkedMinutes ?? 0) / 60 }))
    : [];

  const result = calculatePayroll({
    period: { year: context.year, month: context.month },
    employee: {
      id: employee.id,
      name: employee.name,
      kind,
      schedule: scheduleFor(employee),
      exceptionRole: employee.exceptionRole as ExceptionRole | null,
      joiningDate: employee.joiningDate,
      leftOn: employee.leftOn,
      esiApplicable: employee.esiApplicable,
      pfApplicable: employee.pfApplicable,
      rateHistory,
    },
    days,
    manualDays,
    holidays: context.holidays,
    extras: extras.map((e) => ({ amount: e.amount, reason: e.reason })),
    oneOffDeductions: oneOff,
    recurringDeductions: recurring,
    esiWageThreshold: context.esiWageThreshold,
  });

  return {
    employee,
    days,
    result,
    inPayroll: excluded == null,
    exclusionReason: excluded,
  };
}

export interface PeriodCalculationSummary {
  periodId: string;
  linesWritten: number;
  excluded: number;
  totalFinalPay: number;
  unresolvedFlags: number;
  pendingUnmatched: number;
  pendingZeroPunch: number;
}

/** Recalculate every employee in the period and snapshot the results. */
export async function calculatePeriod(
  periodId: string,
  userId: string | null,
): Promise<PeriodCalculationSummary> {
  const context = await loadPeriodContext(periodId);

  // Everyone active, plus anyone with data in this period even if since inactive.
  const withData = await db.attendanceDay.findMany({
    where: { periodId },
    select: { employeeId: true },
    distinct: ['employeeId'],
  });

  const employees = await db.employee.findMany({
    where: {
      OR: [{ status: 'ACTIVE' }, { id: { in: withData.map((row) => row.employeeId) } }],
    },
    orderBy: { name: 'asc' },
  });

  let totalFinalPay = 0;
  let unresolvedFlags = 0;
  let excluded = 0;

  for (const employee of employees) {
    const detail = await calculateEmployee(context, employee);
    const { result } = detail;

    if (!detail.inPayroll) excluded += 1;
    else {
      totalFinalPay += result.finalPay;
      unresolvedFlags += result.daysUnresolved;
    }

    const data = {
      inPayroll: detail.inPayroll,
      exclusionReason: detail.exclusionReason,
      workedHours: result.workedHours,
      overtimeHours: result.overtimeHours,
      paidLeaveHours: result.paidLeaveHours,
      payableHours: result.payableHours,
      punctualityHours: result.punctualityHours,
      meritHours: result.meritHours,
      daysPresent: result.daysPresent,
      daysAbsent: result.daysAbsent,
      daysFlagged: result.daysFlagged,
      daysUnresolved: result.daysUnresolved,
      daysPunctual: result.daysPunctual,
      daysMerit: result.daysMerit,
      weeklyOffDays: result.weeklyOffDays,
      daysSanctionedLeave: result.daysSanctionedLeave,
      daysUnauthorisedAbsence: result.daysUnauthorisedAbsence,
      daysHalfDay: result.daysHalfDay,
      daysOtherResolution: result.daysOtherResolution,
      daysPaidLeave: result.daysPaidLeave,
      basePay: result.basePay,
      punctualityPay: result.punctualityPay,
      meritPay: result.meritPay,
      holidayPay: result.holidayPay,
      extraTotal: result.extraTotal,
      grossPay: result.grossPay,
      esi: result.esi,
      pf: result.pf,
      netPay: result.netPay,
      oneOffDeductionTotal: result.oneOffDeductionTotal,
      recurringDeductionTotal: result.recurringDeductionTotal,
      deductionTotal: result.deductionTotal,
      finalPay: result.finalPay,
      warnings: JSON.stringify(result.warnings),
      calculatedAt: new Date(),
    };

    await db.payrollLine.upsert({
      where: { periodId_employeeId: { periodId, employeeId: employee.id } },
      create: { periodId, employeeId: employee.id, ...data },
      update: data,
    });
  }

  const pendingUnmatched = await db.unmatchedBlock.count({
    where: { periodId, status: 'PENDING' },
  });
  const pendingZeroPunch = await db.zeroPunchReview.count({
    where: { periodId, decision: null },
  });

  await recordAudit({
    userId,
    action: 'PERIOD_RECALCULATE',
    entityType: 'PayrollPeriod',
    entityId: periodId,
    periodId,
    newValue: { employees: employees.length, totalFinalPay: Math.round(totalFinalPay * 100) / 100 },
  });

  return {
    periodId,
    linesWritten: employees.length,
    excluded,
    totalFinalPay: Math.round(totalFinalPay * 100) / 100,
    unresolvedFlags,
    pendingUnmatched,
    pendingZeroPunch,
  };
}

export interface FlaggedDayRow {
  attendanceDayId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  scheduleType: string;
  computation: DayComputation;
  resolutionTag: string | null;
  resolutionNote: string | null;
  punctualityOverrideNote: string | null;
}

/**
 * The flagged-day review queue: every day the engine could not accept as a
 * clean 8 hours, newest deviation first, with its stored resolution attached.
 */
export async function getFlaggedDays(
  periodId: string,
  options: { includeResolved?: boolean } = {},
): Promise<FlaggedDayRow[]> {
  const context = await loadPeriodContext(periodId);

  const candidates = await db.employee.findMany({
    where: {
      scheduleType: { not: 'EXCEPTION' },
      attendanceDays: { some: { periodId } },
    },
    include: { rates: true },
    orderBy: { name: 'asc' },
  });
  // Salaried staff are paid the same whatever their punches say, so a missing
  // punch is not something anyone needs to review - and three salaried people
  // who never use the device would otherwise put 81 rows in this queue a month.
  const employees = candidates.filter(
    (employee) => !isSalariedFor(toRateHistory(employee.rates), context.year, context.month),
  );

  const excluded = new Set(
    (
      await db.zeroPunchReview.findMany({
        where: { periodId, decision: { in: ['LEFT_INACTIVE', 'EXTENDED_LEAVE'] } },
        select: { employeeId: true },
      })
    ).map((row) => row.employeeId),
  );

  const rows: FlaggedDayRow[] = [];

  for (const employee of employees) {
    if (excluded.has(employee.id)) continue;

    const attendance = await db.attendanceDay.findMany({
      where: { periodId, employeeId: employee.id },
      orderBy: { dayOfMonth: 'asc' },
    });
    const byDay = new Map(attendance.map((row) => [row.dayOfMonth, row]));
    const computations = buildDayComputations(context, employee, attendance);

    for (const computation of computations) {
      if (!computation.isFlagged) continue;
      if (computation.isResolved && !options.includeResolved) continue;

      const row = byDay.get(computation.date.getDate());
      if (!row) continue;

      rows.push({
        attendanceDayId: row.id,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeCode: employee.employeeCode,
        scheduleType: employee.scheduleType,
        computation,
        resolutionTag: row.resolutionTag,
        resolutionNote: row.resolutionNote,
        punctualityOverrideNote: row.punctualityOverrideNote,
      });
    }
  }

  return rows;
}

export interface ReadinessCheck {
  ready: boolean;
  blockers: string[];
}

/**
 * Whether the period can be locked. Spec 26 records this as an assumption
 * rather than a confirmed hard rule, so unresolved items are reported as
 * blockers and the Admin decides - the lock action can override with a note.
 */
export async function checkReadiness(periodId: string): Promise<ReadinessCheck> {
  const blockers: string[] = [];

  const unmatched = await db.unmatchedBlock.count({ where: { periodId, status: 'PENDING' } });
  if (unmatched > 0) blockers.push(`${unmatched} unmatched punch block(s) still in the queue.`);

  const zeroPunch = await db.zeroPunchReview.count({ where: { periodId, decision: null } });
  if (zeroPunch > 0) blockers.push(`${zeroPunch} zero-punch employee(s) not yet reconciled.`);

  const flagged = await db.payrollLine.aggregate({
    where: { periodId, inPayroll: true },
    _sum: { daysUnresolved: true },
  });
  const unresolvedFlags = flagged._sum.daysUnresolved ?? 0;
  if (unresolvedFlags > 0) blockers.push(`${unresolvedFlags} flagged day(s) still unresolved.`);

  // A joining date is optional everywhere else, because most months it changes
  // nothing. It changes something the moment a public holiday falls inside the
  // period: holiday pay needs 365 days of tenure, and tenure nobody has
  // recorded is treated as not qualifying. Raise it here rather than let the
  // period be signed off quietly underpaying someone.
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const monthStart = makeDate(period.year, period.month, 1);
  const monthEnd = makeDate(period.year, period.month, daysInMonth(period.year, period.month));
  const holidays = await db.holiday.count({ where: { date: { gte: monthStart, lte: monthEnd } } });

  if (holidays > 0) {
    const undated = await db.payrollLine.count({
      where: { periodId, inPayroll: true, employee: { joiningDate: null } },
    });
    if (undated > 0) {
      blockers.push(
        `${undated} employee(s) in this payroll have no joining date, and this period contains a public holiday. ` +
          'Holiday pay needs 365 days of tenure, so they are being paid none. Set their joining dates, or approve with a note.',
      );
    }
  }

  return { ready: blockers.length === 0, blockers };
}
