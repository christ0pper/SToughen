/**
 * Assembles the data behind payslips and the summary report.
 *
 * Reads the snapshotted PayrollLine rather than recalculating, so an exported
 * payslip always matches the figures that were on screen when the period was
 * approved.
 */

import { db } from '@/lib/db';
import { daysInMonth, makeDate } from '@/domain/time';
import { isHolidayPayEligible, resolveRate } from '@/domain/pay';
import { payLabel } from '@/lib/format';
import { toRateHistory } from '@/services/payrollService';

export interface PayslipLine {
  label: string;
  amount: number;
}

export interface PayslipData {
  employee: {
    name: string;
    employeeCode: string;
    deviceId: string | null;
    position: string | null;
    scheduleType: string;
    exceptionRole: string | null;
    joiningDate: Date | null;
    esiApplicable: boolean;
    pfApplicable: boolean;
    bankName: string | null;
    bankAccountNumber: string | null;
  };
  period: { year: number; month: number; status: string };
  /** The pay in force at month end, as it should read on a payslip. */
  payLabel: string;
  salaried: boolean;

  hours: {
    worked: number;
    overtime: number;
    paidLeave: number;
    payable: number;
  };
  days: {
    present: number;
    absent: number;
    punctual: number;
    merit: number;
    weeklyOff: number;
    flagged: number;
    unresolved: number;
  };

  earnings: PayslipLine[];
  grossPay: number;
  statutory: PayslipLine[];
  netPay: number;
  deductions: PayslipLine[];
  finalPay: number;

  warnings: string[];
}

export async function getPayslipData(
  periodId: string,
  employeeId: string,
): Promise<PayslipData | null> {
  const line = await db.payrollLine.findUnique({
    where: { periodId_employeeId: { periodId, employeeId } },
    include: { employee: { include: { rates: true } }, period: true },
  });
  if (!line) return null;

  const { employee, period } = line;
  const monthEnd = makeDate(period.year, period.month, daysInMonth(period.year, period.month));

  const [oneOff, recurring, extras] = await Promise.all([
    db.deduction.findMany({ where: { employeeId, kind: 'ONE_OFF', periodId } }),
    db.deduction.findMany({
      where: {
        employeeId,
        kind: 'RECURRING',
        active: true,
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: monthEnd } }] },
          { OR: [{ endDate: null }, { endDate: { gte: makeDate(period.year, period.month, 1) } }] },
        ],
      },
    }),
    db.extraBonus.findMany({ where: { employeeId, periodId } }),
  ]);

  const earnings: PayslipLine[] = [
    { label: 'Basic (hours worked)', amount: line.basePay },
  ];
  if (line.punctualityPay > 0)
    earnings.push({ label: `Punctuality (${line.daysPunctual} days)`, amount: line.punctualityPay });
  if (line.meritPay > 0)
    earnings.push({ label: `Merit (${line.daysMerit} days)`, amount: line.meritPay });
  if (line.holidayPay > 0) earnings.push({ label: 'Public holiday pay', amount: line.holidayPay });
  for (const extra of extras) earnings.push({ label: `Extra — ${extra.reason}`, amount: extra.amount });

  const statutory: PayslipLine[] = [];
  if (line.esi > 0) statutory.push({ label: 'ESI (0.75%)', amount: line.esi });
  if (line.pf > 0) statutory.push({ label: 'PF (12%, capped)', amount: line.pf });

  const deductions: PayslipLine[] = [
    ...oneOff.map((d) => ({ label: `${d.reason} (one-off)`, amount: d.amount })),
    ...recurring.map((d) => ({ label: `${d.reason} (recurring)`, amount: d.amount })),
  ];

  return {
    employee: {
      name: employee.name,
      employeeCode: employee.employeeCode,
      deviceId: employee.deviceId,
      position: employee.position,
      scheduleType: employee.scheduleType,
      exceptionRole: employee.exceptionRole,
      joiningDate: employee.joiningDate,
      esiApplicable: employee.esiApplicable,
      pfApplicable: employee.pfApplicable,
      bankName: employee.bankName,
      bankAccountNumber: employee.bankAccountNumber,
    },
    period: { year: period.year, month: period.month, status: period.status },
    payLabel: payLabel(resolveRate(toRateHistory(employee.rates), monthEnd)),
    salaried: resolveRate(toRateHistory(employee.rates), monthEnd)?.payBasis === 'MONTHLY',
    hours: {
      worked: line.workedHours,
      overtime: line.overtimeHours,
      paidLeave: line.paidLeaveHours,
      payable: line.payableHours,
    },
    days: {
      present: line.daysPresent,
      absent: line.daysAbsent,
      punctual: line.daysPunctual,
      merit: line.daysMerit,
      weeklyOff: line.weeklyOffDays,
      flagged: line.daysFlagged,
      unresolved: line.daysUnresolved,
    },
    earnings,
    grossPay: line.grossPay,
    statutory,
    netPay: line.netPay,
    deductions,
    finalPay: line.finalPay,
    warnings: JSON.parse(line.warnings || '[]') as string[],
  };
}

export interface SummaryRow {
  employeeCode: string;
  name: string;
  schedule: string;
  deviceId: string;
  inPayroll: boolean;
  exclusionReason: string;
  payableHours: number;
  overtimeHours: number;
  daysPresent: number;
  daysAbsent: number;
  daysPunctual: number;
  daysMerit: number;
  basePay: number;
  punctualityPay: number;
  meritPay: number;
  holidayPay: number;
  extraTotal: number;
  grossPay: number;
  esi: number;
  pf: number;
  netPay: number;
  deductionTotal: number;
  finalPay: number;
  unresolvedFlags: number;
}

export async function getSummaryRows(periodId: string): Promise<SummaryRow[]> {
  const lines = await db.payrollLine.findMany({
    where: { periodId },
    include: { employee: true },
    orderBy: { employee: { name: 'asc' } },
  });

  return lines.map((line) => ({
    employeeCode: line.employee.employeeCode,
    name: line.employee.name,
    schedule:
      line.employee.scheduleType === 'EXCEPTION'
        ? `EXCEPTION (${line.employee.exceptionRole ?? '—'})`
        : line.employee.scheduleType,
    deviceId: line.employee.deviceId ?? '',
    inPayroll: line.inPayroll,
    exclusionReason: line.exclusionReason ?? '',
    payableHours: line.payableHours,
    overtimeHours: line.overtimeHours,
    daysPresent: line.daysPresent,
    daysAbsent: line.daysAbsent,
    daysPunctual: line.daysPunctual,
    daysMerit: line.daysMerit,
    basePay: line.basePay,
    punctualityPay: line.punctualityPay,
    meritPay: line.meritPay,
    holidayPay: line.holidayPay,
    extraTotal: line.extraTotal,
    grossPay: line.grossPay,
    esi: line.esi,
    pf: line.pf,
    netPay: line.netPay,
    deductionTotal: line.deductionTotal,
    finalPay: line.finalPay,
    unresolvedFlags: line.daysUnresolved,
  }));
}

/** Holiday lines for the period, with how many employees qualified. */
export async function getHolidaySummary(periodId: string) {
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const start = makeDate(period.year, period.month, 1);
  const end = makeDate(period.year, period.month, daysInMonth(period.year, period.month));

  const [holidays, employees] = await Promise.all([
    db.holiday.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } }),
    db.employee.findMany({ where: { status: 'ACTIVE' }, select: { joiningDate: true } }),
  ]);

  return holidays.map((holiday) => ({
    date: holiday.date,
    name: holiday.name,
    eligibleCount: employees.filter((e) => isHolidayPayEligible(e.joiningDate, holiday.date)).length,
    totalActive: employees.length,
  }));
}
