/**
 * PAY CALCULATION (spec 12.11).
 *
 *   Gross = Base + Punctuality + Merit + Holiday + Extra/Bonus
 *   Net   = Gross - ESI - PF
 *   Final = Net - (one-off + recurring deductions)
 *
 * Base pay is accumulated day by day using the hourly rate that was in effect
 * on each day, so a mid-month raise and any later recalculation of a historical
 * period both come out right (spec 12.12).
 */

import { PAY_RULES, type ExceptionRole, type ScheduleCode } from './config';
import { daysBetween, daysInMonth, isoDate, makeDate, minutesToHours } from './time';
import type { DayComputation } from './types';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type PayBasis = 'HOURLY' | 'MONTHLY';

export interface RateHistoryEntry {
  effectiveFrom: Date;
  /** Absent on older callers, which only ever dealt in hourly rates. */
  payBasis?: PayBasis;
  hourlyRate: number;
  monthlySalary?: number | null;
}

/**
 * The pay entry in force on a given date, of whichever basis. Null when nothing
 * covers that date - the caller surfaces that rather than paying 0.
 */
export function resolveRate(history: RateHistoryEntry[], on: Date): RateHistoryEntry | null {
  const applicable = history
    .filter((entry) => entry.effectiveFrom.getTime() <= on.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return applicable[0] ?? null;
}

/**
 * The hourly rate in force on a given date. Null when there is no rate, AND when
 * the entry in force is a monthly salary - a salaried day has no hourly rate, and
 * reporting the unused 0 stored on that row would read as "paid nothing".
 */
export function resolveHourlyRate(history: RateHistoryEntry[], on: Date): number | null {
  const entry = resolveRate(history, on);
  if (!entry || (entry.payBasis ?? 'HOURLY') !== 'HOURLY') return null;
  return entry.hourlyRate;
}

/** Whether a period is paid as a fixed salary: the basis in force on its last day. */
export function isSalariedFor(history: RateHistoryEntry[], year: number, month: number): boolean {
  const lastDay = makeDate(year, month, daysInMonth(year, month));
  return resolveRate(history, lastDay)?.payBasis === 'MONTHLY';
}

/**
 * Spec 12.10: holiday pay needs 365+ days of tenure as at the holiday date.
 *
 * Without a joining date there is no tenure to measure, so this answers no.
 * That is a deliberate choice between two wrong answers: paying would hand
 * money to someone who may not have earned it and nothing would ever surface
 * the mistake, whereas withholding is visible, reported on the period screen,
 * and fixed by filling the date in and recalculating. Never silently pay on a
 * fact nobody has supplied.
 */
export function isHolidayPayEligible(joiningDate: Date | null, holidayDate: Date): boolean {
  if (!joiningDate) return false;
  return daysBetween(joiningDate, holidayDate) >= PAY_RULES.holidayTenureDays;
}

export interface ManualDayEntry {
  date: Date;
  hours: number;
}

export interface HolidayEntry {
  date: Date;
  name: string;
}

export interface AmountEntry {
  amount: number;
  reason: string;
}

export interface PayrollEmployee {
  id: string;
  name: string;
  /**
   * PUNCH     - paid for hours worked, read from the biometric file.
   * EXCEPTION - paid for hours an Admin enters by hand (managers, drivers).
   * SALARIED  - a fixed monthly salary; attendance does not change the amount.
   */
  kind: 'PUNCH' | 'EXCEPTION' | 'SALARIED';
  schedule: ScheduleCode;
  exceptionRole?: ExceptionRole | null;
  joiningDate: Date | null;
  /** Last day employed, if they have left. Salary stops accruing after it. */
  leftOn?: Date | null;
  esiApplicable: boolean;
  pfApplicable: boolean;
  rateHistory: RateHistoryEntry[];
}

export interface PayrollInput {
  /** Which calendar month this is. A salary is spread across its days. */
  period: { year: number; month: number };
  employee: PayrollEmployee;
  /** Computed days - punch-based employees only. */
  days: DayComputation[];
  /** Manually entered hours - exception-role employees only. */
  manualDays: ManualDayEntry[];
  holidays: HolidayEntry[];
  extras: AmountEntry[];
  oneOffDeductions: AmountEntry[];
  recurringDeductions: AmountEntry[];
  /** Admin-configured. No statutory default is assumed (spec 11.12). */
  esiWageThreshold: number | null;
}

export interface HolidayPayLine {
  date: Date;
  name: string;
  eligible: boolean;
  /** Not eligible because nobody has recorded a joining date, rather than because
   *  the person is genuinely too new. The two look identical in the money and
   *  entirely different to whoever has to fix it. */
  tenureUnknown: boolean;
  hourlyRate: number | null;
  amount: number;
}

export interface PayrollResult {
  employeeId: string;

  // hours
  workedHours: number;
  overtimeHours: number;
  paidLeaveHours: number;
  payableHours: number;
  punctualityHours: number;
  meritHours: number;

  // day counts, for payslips and the analytics dashboard
  daysPresent: number;
  daysAbsent: number;
  daysFlagged: number;
  daysUnresolved: number;
  daysPunctual: number;
  daysMerit: number;
  weeklyOffDays: number;

  // leave, by how the reviewer categorised the day (spec 12.4)
  daysSanctionedLeave: number;
  daysUnauthorisedAbsence: number;
  daysHalfDay: number;
  daysOtherResolution: number;
  /** Days carrying any paid-leave minutes. All leave is unpaid by default. */
  daysPaidLeave: number;

  // money
  basePay: number;
  punctualityPay: number;
  meritPay: number;
  holidayPay: number;
  holidayLines: HolidayPayLine[];
  extraTotal: number;
  grossPay: number;

  esi: number;
  pf: number;
  netPay: number;

  oneOffDeductionTotal: number;
  recurringDeductionTotal: number;
  deductionTotal: number;
  finalPay: number;

  /** Non-fatal conditions the reviewer must see before approving. */
  warnings: string[];
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const { employee } = input;
  const warnings: string[] = [];
  const isPunchBased = employee.kind === 'PUNCH';

  const rateOn = (date: Date): number | null => {
    const rate = resolveHourlyRate(employee.rateHistory, date);
    if (rate == null) {
      warnings.push(
        `No hourly rate is on record for ${isoDate(date)} - that day was paid as zero.`,
      );
      return null;
    }
    return rate;
  };

  // --- base pay ------------------------------------------------------------
  let basePay = 0;
  let workedMinutes = 0;
  let overtimeMinutes = 0;
  let paidLeaveMinutes = 0;
  let payableMinutes = 0;
  let punctualityMinutes = 0;
  let meritMinutes = 0;
  let daysPresent = 0;
  let daysAbsent = 0;
  let daysFlagged = 0;
  let daysUnresolved = 0;
  let daysPunctual = 0;
  let daysMerit = 0;
  let weeklyOffDays = 0;
  let daysSanctionedLeave = 0;
  let daysUnauthorisedAbsence = 0;
  let daysHalfDay = 0;
  let daysOtherResolution = 0;
  let daysPaidLeave = 0;

  if (isPunchBased) {
    for (const day of input.days) {
      if (day.isWeeklyOff) weeklyOffDays += 1;
      if (day.isFlagged) daysFlagged += 1;
      if (day.isFlagged && !day.isResolved) daysUnresolved += 1;

      if (day.creditedWorkMinutes > 0) daysPresent += 1;
      else if (day.isExpectedWorkingDay && !day.isPublicHoliday) daysAbsent += 1;

      if (day.resolutionTag === 'SANCTIONED_LEAVE') daysSanctionedLeave += 1;
      else if (day.resolutionTag === 'UNAUTHORIZED_ABSENCE') daysUnauthorisedAbsence += 1;
      else if (day.resolutionTag === 'HALF_DAY') daysHalfDay += 1;
      else if (day.resolutionTag === 'OTHER') daysOtherResolution += 1;
      if (day.paidLeaveMinutes > 0) daysPaidLeave += 1;

      workedMinutes += day.workedMinutes;
      overtimeMinutes += day.confirmedOtMinutes;
      paidLeaveMinutes += day.paidLeaveMinutes;
      payableMinutes += day.payableMinutes;

      const rate = day.payableMinutes > 0 ? rateOn(day.date) : 0;
      basePay += minutesToHours(day.payableMinutes) * (rate ?? 0);

      if (day.punctualityAwarded) {
        daysPunctual += 1;
        punctualityMinutes += day.creditedWorkMinutes;
      }
      if (day.meritAwarded) {
        daysMerit += 1;
        meritMinutes += day.creditedWorkMinutes;
      }
    }
  } else if (employee.kind === 'SALARIED') {
    // A fixed salary, spread across the calendar days of the month so that a
    // mid-month start, exit or raise is prorated by the day.
    //
    // Attendance is deliberately not read. Salaried staff often never touch the
    // biometric device - in the July file three of the five punched zero times
    // - and treating every unpunched day as absence would pay them nothing.
    // Unpaid leave for salaried staff is a one-off deduction, entered on purpose.
    const { year, month } = input.period;
    const totalDays = daysInMonth(year, month);
    const joined = employee.joiningDate ? isoDate(employee.joiningDate) : null;
    const left = employee.leftOn ? isoDate(employee.leftOn) : null;
    let unratedDays = 0;
    let hourlyDays = 0;

    for (let dayOfMonth = 1; dayOfMonth <= totalDays; dayOfMonth += 1) {
      const date = makeDate(year, month, dayOfMonth);
      const key = isoDate(date);
      if (joined && key < joined) continue;
      if (left && key > left) continue;

      const entry = resolveRate(employee.rateHistory, date);
      if (!entry) {
        unratedDays += 1;
        continue;
      }
      if (entry.payBasis !== 'MONTHLY') {
        hourlyDays += 1;
        continue;
      }
      basePay += (entry.monthlySalary ?? 0) / totalDays;
    }

    if (unratedDays > 0) {
      warnings.push(
        `No salary is on record for ${unratedDays} day(s) of this month - those days were paid as zero.`,
      );
    }
    if (hourlyDays > 0) {
      // Rare, and not worth guessing at: the hourly days have no punch hours
      // computed for a salaried month, so they cannot be paid correctly here.
      warnings.push(
        `Pay changed between hourly and a monthly salary during this month. The ${hourlyDays} day(s) on the hourly rate were not paid - check this month by hand.`,
      );
    }
  } else {
    // Exception roles: entered hours are final. No breaks, no punctuality, no merit.
    for (const entry of input.manualDays) {
      const minutes = Math.max(0, Math.round(entry.hours * 60));
      workedMinutes += minutes;
      payableMinutes += minutes;
      if (minutes > 0) daysPresent += 1;
      const rate = minutes > 0 ? rateOn(entry.date) : 0;
      basePay += minutesToHours(minutes) * (rate ?? 0);
    }
  }

  // --- bonuses -------------------------------------------------------------
  const punctualityPay = isPunchBased
    ? minutesToHours(punctualityMinutes) * PAY_RULES.punctualityRatePerHour
    : 0;
  const meritPay = isPunchBased ? minutesToHours(meritMinutes) * PAY_RULES.meritRatePerHour : 0;

  // A salary already covers public holidays; paying holiday pay on top of it
  // would pay those days twice.
  const holidays = employee.kind === 'SALARIED' ? [] : input.holidays;
  const holidayLines: HolidayPayLine[] = holidays.map((holiday) => {
    const eligible = isHolidayPayEligible(employee.joiningDate, holiday.date);
    const rate = eligible ? resolveHourlyRate(employee.rateHistory, holiday.date) : null;
    const amount = eligible && rate != null ? PAY_RULES.holidayPaidHours * rate : 0;
    return {
      date: holiday.date,
      name: holiday.name,
      eligible,
      tenureUnknown: employee.joiningDate == null,
      hourlyRate: rate,
      amount,
    };
  });
  const holidayPay = holidayLines.reduce((sum, line) => sum + line.amount, 0);

  const extraTotal = input.extras.reduce((sum, e) => sum + e.amount, 0);

  const grossPay = round2(basePay + punctualityPay + meritPay + holidayPay + extraTotal);

  // --- statutory -----------------------------------------------------------
  // ESI/PF are controlled entirely by the employee's own flags (spec 14.3).
  // Spec 12.11 states exception roles are not applicable, but that is applied
  // as the DEFAULT when an exception-role employee is created (see the
  // employee form), not as a hardcoded block here - HR/Admin can still tick
  // ESI/PF on for a specific manager or driver who does carry the deduction.
  const esi = employee.esiApplicable ? round2(grossPay * PAY_RULES.esiRate) : 0;
  const pf = employee.pfApplicable
    ? round2(Math.min(grossPay * PAY_RULES.pfRate, PAY_RULES.pfCapAmount))
    : 0;

  if (
    employee.esiApplicable &&
    input.esiWageThreshold != null &&
    grossPay > input.esiWageThreshold
  ) {
    warnings.push(
      `Gross pay ${grossPay.toFixed(2)} exceeds the configured ESI wage threshold ${input.esiWageThreshold.toFixed(2)}. Confirm ESI still applies.`,
    );
  }
  if (employee.esiApplicable && input.esiWageThreshold == null) {
    warnings.push('No ESI wage threshold is configured, so no threshold check was performed.');
  }
  if (daysUnresolved > 0) {
    warnings.push(`${daysUnresolved} flagged day(s) are still unresolved.`);
  }

  const netPay = round2(grossPay - esi - pf);

  // --- deductions ----------------------------------------------------------
  const oneOffDeductionTotal = round2(
    input.oneOffDeductions.reduce((sum, d) => sum + d.amount, 0),
  );
  const recurringDeductionTotal = round2(
    input.recurringDeductions.reduce((sum, d) => sum + d.amount, 0),
  );
  const deductionTotal = round2(oneOffDeductionTotal + recurringDeductionTotal);
  const finalPay = round2(netPay - deductionTotal);

  if (finalPay < 0) {
    warnings.push('Deductions exceed net pay, leaving a negative final amount.');
  }

  return {
    employeeId: employee.id,
    workedHours: minutesToHours(workedMinutes),
    overtimeHours: minutesToHours(overtimeMinutes),
    paidLeaveHours: minutesToHours(paidLeaveMinutes),
    payableHours: minutesToHours(payableMinutes),
    punctualityHours: minutesToHours(punctualityMinutes),
    meritHours: minutesToHours(meritMinutes),
    daysPresent,
    daysAbsent,
    daysFlagged,
    daysUnresolved,
    daysPunctual,
    daysMerit,
    weeklyOffDays,
    daysSanctionedLeave,
    daysUnauthorisedAbsence,
    daysHalfDay,
    daysOtherResolution,
    daysPaidLeave,
    basePay: round2(basePay),
    punctualityPay: round2(punctualityPay),
    meritPay: round2(meritPay),
    holidayPay: round2(holidayPay),
    holidayLines,
    extraTotal: round2(extraTotal),
    grossPay,
    esi,
    pf,
    netPay,
    oneOffDeductionTotal,
    recurringDeductionTotal,
    deductionTotal,
    finalPay,
    warnings,
  };
}
