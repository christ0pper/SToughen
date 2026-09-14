/**
 * Analytics over the retained payroll history.
 *
 * Scope is deliberately limited to the metrics the spec confirms (11.17, 15):
 * hours worked, days worked, leaves taken, penalties/deductions, the
 * punctuality-rate trend over time, and cross-employee comparison. Spec 23 and
 * 27 record that the wider "whatever else is useful" list is unscoped and must
 * not be invented — so nothing beyond the confirmed set is computed here.
 *
 * Everything reads the snapshotted PayrollLine, so a historical period reports
 * the figures it was actually approved on.
 */

import { db } from '@/lib/db';
import { periodLabel } from '@/lib/format';

/**
 * Punctuality rate = fully on-time days as a share of days actually worked.
 * Absent days are excluded from the denominator: they contribute nothing to
 * punctuality pay either way, and counting them would make a month of sick
 * leave look like a punctuality collapse. Null when nothing was worked.
 */
export function punctualityRate(punctualDays: number, daysPresent: number): number | null {
  if (daysPresent <= 0) return null;
  return Math.round((punctualDays / daysPresent) * 1000) / 10;
}

export interface PeriodTrendPoint {
  periodId: string;
  year: number;
  month: number;
  label: string;
  status: string;

  headcount: number;
  payableHours: number;
  overtimeHours: number;
  daysPresent: number;
  daysAbsent: number;

  leaveDays: number;
  sanctionedLeave: number;
  unauthorisedAbsence: number;
  halfDays: number;
  otherResolution: number;
  paidLeaveDays: number;

  punctualDays: number;
  punctualityRate: number | null;
  meritDays: number;

  grossPay: number;
  esi: number;
  pf: number;
  deductionTotal: number;
  finalPay: number;

  unresolvedFlags: number;
}

/**
 * Company-wide totals per period, oldest first so charts read left to right.
 *
 * `approvedOnly` is the default for anything that reports company performance.
 * A draft period is a work in progress - blocks still unmatched, days still
 * flagged, rates still being set - and its totals move every time somebody
 * clears a queue item. Letting those figures into the dashboard means the
 * headline payroll cost changes under you during review, and a number nobody
 * has signed off gets quoted as fact. Approving a period is what makes it
 * count.
 */
export async function getPeriodTrend(
  limit = 24,
  options: { approvedOnly?: boolean } = {},
): Promise<PeriodTrendPoint[]> {
  const periods = await db.payrollPeriod.findMany({
    where: options.approvedOnly ? { status: 'LOCKED' } : undefined,
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: limit,
    include: {
      payrollLines: {
        where: { inPayroll: true },
        include: { employee: { select: { scheduleType: true } } },
      },
    },
  });

  return periods
    .map((period) => {
      const lines = period.payrollLines;
      const sum = (pick: (line: (typeof lines)[number]) => number) =>
        lines.reduce((total, line) => total + pick(line), 0);

      const daysPresent = sum((l) => l.daysPresent);
      const punctualDays = sum((l) => l.daysPunctual);

      // Exception roles cannot earn punctuality pay at all (spec 12.8), so
      // their days must stay out of the denominator - otherwise hiring a
      // driver would look like a company-wide punctuality collapse.
      const punchLines = lines.filter((line) => line.employee.scheduleType !== 'EXCEPTION');
      const punchDaysPresent = punchLines.reduce((total, line) => total + line.daysPresent, 0);
      const punchPunctualDays = punchLines.reduce((total, line) => total + line.daysPunctual, 0);

      const sanctionedLeave = sum((l) => l.daysSanctionedLeave);
      const unauthorisedAbsence = sum((l) => l.daysUnauthorisedAbsence);
      const halfDays = sum((l) => l.daysHalfDay);
      const otherResolution = sum((l) => l.daysOtherResolution);

      return {
        periodId: period.id,
        year: period.year,
        month: period.month,
        label: periodLabel(period.year, period.month),
        status: period.status,

        headcount: lines.length,
        payableHours: Math.round(sum((l) => l.payableHours) * 100) / 100,
        overtimeHours: Math.round(sum((l) => l.overtimeHours) * 100) / 100,
        daysPresent,
        daysAbsent: sum((l) => l.daysAbsent),

        leaveDays: sanctionedLeave + unauthorisedAbsence + halfDays + otherResolution,
        sanctionedLeave,
        unauthorisedAbsence,
        halfDays,
        otherResolution,
        paidLeaveDays: sum((l) => l.daysPaidLeave),

        punctualDays,
        punctualityRate: punctualityRate(punchPunctualDays, punchDaysPresent),
        meritDays: sum((l) => l.daysMerit),

        grossPay: Math.round(sum((l) => l.grossPay) * 100) / 100,
        esi: Math.round(sum((l) => l.esi) * 100) / 100,
        pf: Math.round(sum((l) => l.pf) * 100) / 100,
        deductionTotal: Math.round(sum((l) => l.deductionTotal) * 100) / 100,
        finalPay: Math.round(sum((l) => l.finalPay) * 100) / 100,

        unresolvedFlags: sum((l) => l.daysUnresolved),
      };
    })
    .reverse();
}

export interface EmployeeComparisonRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  scheduleType: string;
  exceptionRole: string | null;
  status: string;

  periodsIncluded: number;
  payableHours: number;
  overtimeHours: number;
  daysPresent: number;
  daysAbsent: number;
  leaveDays: number;
  punctualDays: number;
  punctualityRate: number | null;
  meritDays: number;
  deductionTotal: number;
  grossPay: number;
  finalPay: number;
}

/**
 * Cross-employee comparison. Pass a periodId for a single month, or omit it to
 * aggregate every period on record.
 */
export async function getEmployeeComparison(
  periodId?: string | null,
): Promise<EmployeeComparisonRow[]> {
  const lines = await db.payrollLine.findMany({
    where: { inPayroll: true, ...(periodId ? { periodId } : {}) },
    include: { employee: true },
  });

  const byEmployee = new Map<string, EmployeeComparisonRow>();

  for (const line of lines) {
    const existing = byEmployee.get(line.employeeId);
    const row: EmployeeComparisonRow = existing ?? {
      employeeId: line.employeeId,
      name: line.employee.name,
      employeeCode: line.employee.employeeCode,
      scheduleType: line.employee.scheduleType,
      exceptionRole: line.employee.exceptionRole,
      status: line.employee.status,
      periodsIncluded: 0,
      payableHours: 0,
      overtimeHours: 0,
      daysPresent: 0,
      daysAbsent: 0,
      leaveDays: 0,
      punctualDays: 0,
      punctualityRate: null,
      meritDays: 0,
      deductionTotal: 0,
      grossPay: 0,
      finalPay: 0,
    };

    row.periodsIncluded += 1;
    row.payableHours += line.payableHours;
    row.overtimeHours += line.overtimeHours;
    row.daysPresent += line.daysPresent;
    row.daysAbsent += line.daysAbsent;
    row.leaveDays +=
      line.daysSanctionedLeave +
      line.daysUnauthorisedAbsence +
      line.daysHalfDay +
      line.daysOtherResolution;
    row.punctualDays += line.daysPunctual;
    row.meritDays += line.daysMerit;
    row.deductionTotal += line.deductionTotal;
    row.grossPay += line.grossPay;
    row.finalPay += line.finalPay;

    byEmployee.set(line.employeeId, row);
  }

  return [...byEmployee.values()]
    .map((row) => ({
      ...row,
      payableHours: Math.round(row.payableHours * 100) / 100,
      overtimeHours: Math.round(row.overtimeHours * 100) / 100,
      deductionTotal: Math.round(row.deductionTotal * 100) / 100,
      grossPay: Math.round(row.grossPay * 100) / 100,
      finalPay: Math.round(row.finalPay * 100) / 100,
      // Not applicable, not zero - an exception role is never eligible.
      punctualityRate:
        row.scheduleType === 'EXCEPTION'
          ? null
          : punctualityRate(row.punctualDays, row.daysPresent),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface EmployeeTrendPoint {
  periodId: string;
  label: string;
  year: number;
  month: number;
  payableHours: number;
  daysPresent: number;
  daysAbsent: number;
  leaveDays: number;
  punctualDays: number;
  punctualityRate: number | null;
  meritDays: number;
  deductionTotal: number;
  grossPay: number;
  finalPay: number;
}

/** One employee's history across every period, oldest first. */
export async function getEmployeeTrend(
  employeeId: string,
  limit = 24,
): Promise<EmployeeTrendPoint[]> {
  const lines = await db.payrollLine.findMany({
    where: { employeeId, inPayroll: true },
    include: { period: true, employee: { select: { scheduleType: true } } },
    orderBy: [{ period: { year: 'desc' } }, { period: { month: 'desc' } }],
    take: limit,
  });

  return lines
    .map((line) => ({
      periodId: line.periodId,
      label: periodLabel(line.period.year, line.period.month),
      year: line.period.year,
      month: line.period.month,
      payableHours: line.payableHours,
      daysPresent: line.daysPresent,
      daysAbsent: line.daysAbsent,
      leaveDays:
        line.daysSanctionedLeave +
        line.daysUnauthorisedAbsence +
        line.daysHalfDay +
        line.daysOtherResolution,
      punctualDays: line.daysPunctual,
      punctualityRate:
        line.employee.scheduleType === 'EXCEPTION'
          ? null
          : punctualityRate(line.daysPunctual, line.daysPresent),
      meritDays: line.daysMerit,
      deductionTotal: line.deductionTotal,
      grossPay: line.grossPay,
      finalPay: line.finalPay,
    }))
    .reverse();
}

export interface DashboardFilters {
  periodId: string | null;
}

/** The periods available to filter by, newest first. */
export async function getSelectablePeriods() {
  return db.payrollPeriod.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: { id: true, year: true, month: true, status: true },
  });
}

export interface DraftPeriod {
  id: string;
  year: number;
  month: number;
  label: string;
  employeeCount: number;
  finalPay: number;
}

/** Periods that have been calculated but not yet signed off. */
export async function getDraftPeriods(): Promise<DraftPeriod[]> {
  const periods = await db.payrollPeriod.findMany({
    where: { status: 'DRAFT' },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: { payrollLines: { where: { inPayroll: true }, select: { finalPay: true } } },
  });

  return periods.map((period) => ({
    id: period.id,
    year: period.year,
    month: period.month,
    label: periodLabel(period.year, period.month),
    employeeCount: period.payrollLines.length,
    finalPay: period.payrollLines.reduce((total, line) => total + line.finalPay, 0),
  }));
}
