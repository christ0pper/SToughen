/**
 * HOUR CALCULATION ENGINE (punch-based employees).
 *
 * Pipeline: normalise punches -> apply rounding -> deduct unpaid breaks ->
 * layer human resolutions on top -> flag anything that is not a clean 8 hours.
 *
 * Nothing here reads the device's own Duration / Late By / Early By / OT /
 * Shift columns. Everything is recomputed from raw InTime/OutTime against the
 * employee's assigned schedule, per spec section 25.
 */

import {
  BREAKS,
  PAY_RULES,
  ROUNDING,
  SCHEDULES,
  type ScheduleCode,
} from './config';
import { MINUTES_PER_DAY, isSunday, isoDate, overlapMinutes } from './time';
import {
  EMPTY_RESOLUTION,
  type BreakDeduction,
  type DayComputation,
  type DayInput,
  type DayResolution,
  type FlagReason,
} from './types';

/** Time punched beyond the shift that still counts as "near enough", in minutes. */
const OVERTIME_REVIEW_THRESHOLD_MINUTES = 30;

/**
 * Spec 12.3's rounding grace on the two sides that reduce hours (late arrival,
 * early departure). Left as a parameter rather than a hardcoded constant so the
 * caller can supply the value the Admin set in Settings - this module stays
 * pure and knows nothing about the database. Defaults to `ROUNDING.*` (in turn
 * env-configurable) for any caller that does not pass one, e.g. a test.
 */
export interface GraceMinutes {
  lateArrival: number;
  earlyDeparture: number;
}

export const DEFAULT_GRACE: GraceMinutes = {
  lateArrival: ROUNDING.lateArrivalGraceMinutes,
  earlyDeparture: ROUNDING.earlyDepartureGraceMinutes,
};

/**
 * Put a punch pair on a single monotonic timeline.
 *
 * For a midnight-spanning schedule (NS) a punch-in that reads as early morning
 * belongs to the following calendar day, so it is pushed forward a day. A
 * punch-out earlier than the punch-in always means the shift crossed midnight.
 */
export function normalisePunchPair(
  rawIn: number | null,
  rawOut: number | null,
  schedule: ScheduleCode,
): { inMinutes: number | null; outMinutes: number | null } {
  const def = SCHEDULES[schedule];
  let inMinutes = rawIn;
  let outMinutes = rawOut;

  if (inMinutes != null && def.spansMidnight) {
    // Anchor to shift start: anything more than 12h "before" it is really after it.
    if (inMinutes < def.startMinutes - MINUTES_PER_DAY / 2) {
      inMinutes += MINUTES_PER_DAY;
    }
  }

  if (inMinutes != null && outMinutes != null && outMinutes < inMinutes) {
    outMinutes += MINUTES_PER_DAY;
  }

  return { inMinutes, outMinutes };
}

/** Apply spec 12.3 rounding to a punch-in. */
export function roundPunchIn(
  inMinutes: number,
  schedule: ScheduleCode,
  graceMinutes: number = DEFAULT_GRACE.lateArrival,
): number {
  const { startMinutes } = SCHEDULES[schedule];
  // Early arrival is never credited, at any distance.
  if (inMinutes <= startMinutes) {
    return ROUNDING.creditEarlyArrival ? inMinutes : startMinutes;
  }
  // Late arrival: rounded back to start only inside the configured grace.
  if (inMinutes <= startMinutes + graceMinutes) return startMinutes;
  return inMinutes;
}

/** Apply spec 12.3 rounding to a punch-out. */
export function roundPunchOut(
  outMinutes: number,
  schedule: ScheduleCode,
  graceMinutes: number = DEFAULT_GRACE.earlyDeparture,
): number {
  const { endMinutes } = SCHEDULES[schedule];
  // Late departure is capped at shift end regardless (bullet 4).
  if (outMinutes >= endMinutes) {
    return ROUNDING.creditLateDeparture ? outMinutes : endMinutes;
  }
  // Early departure: rounded up to end only inside the configured grace.
  if (outMinutes >= endMinutes - graceMinutes) return endMinutes;
  return outMinutes;
}

/**
 * Unpaid breaks overlapping the worked span. A break the employee was not on
 * site for is not deducted (spec 12.2); a partial overlap deducts only the
 * overlapping minutes.
 */
export function computeBreakDeductions(
  effectiveIn: number,
  effectiveOut: number,
  schedule: ScheduleCode,
): BreakDeduction[] {
  const def = SCHEDULES[schedule];
  if (!def.breaksApply || schedule === 'NS') return [];

  const key = schedule as 'OS' | 'PS';
  return BREAKS.map((brk) => {
    const slotStart = brk.slotStart[key];
    const slotEnd = slotStart + brk.durationMinutes;
    const minutes = Math.min(
      brk.durationMinutes,
      overlapMinutes(slotStart, slotEnd, effectiveIn, effectiveOut),
    );
    return { key: brk.key, label: brk.label, minutes };
  }).filter((d) => d.minutes > 0);
}

/**
 * Compute one employee-day.
 *
 * @param input      raw punch row for the day
 * @param schedule   the employee's assigned schedule (never the device's label)
 * @param resolution human decisions already recorded for this day
 * @param grace      the rounding grace in force (Admin-configurable in Settings)
 */
export function computeDay(
  input: DayInput,
  schedule: ScheduleCode,
  resolution: DayResolution = EMPTY_RESOLUTION,
  grace: GraceMinutes = DEFAULT_GRACE,
): DayComputation {
  const def = SCHEDULES[schedule];
  const weeklyOff = isSunday(input.date);
  const publicHoliday = input.isPublicHoliday === true;
  // Saturday is a normal full working day; Sunday is the only true weekly off.
  const expectedWorkingDay = !weeklyOff;

  const { inMinutes, outMinutes } = normalisePunchPair(input.rawIn, input.rawOut, schedule);
  const hasIn = inMinutes != null;
  const hasOut = outMinutes != null;

  const flags: FlagReason[] = [];

  let effectiveIn: number | null = null;
  let effectiveOut: number | null = null;
  let spanMinutes = 0;
  let breakDeductions: BreakDeduction[] = [];
  let breakMinutes = 0;
  let calculatedWorkedMinutes = 0;
  let earlyArrivalMinutes = 0;
  let lateDepartureMinutes = 0;

  if (inMinutes != null && outMinutes != null) {
    effectiveIn = roundPunchIn(inMinutes, schedule, grace.lateArrival);
    effectiveOut = roundPunchOut(outMinutes, schedule, grace.earlyDeparture);
    spanMinutes = Math.max(0, effectiveOut - effectiveIn);
    breakDeductions = computeBreakDeductions(effectiveIn, effectiveOut, schedule);
    breakMinutes = breakDeductions.reduce((sum, d) => sum + d.minutes, 0);
    calculatedWorkedMinutes = Math.max(0, spanMinutes - breakMinutes);

    earlyArrivalMinutes = Math.max(0, def.startMinutes - inMinutes);
    lateDepartureMinutes = Math.max(0, outMinutes - def.endMinutes);
  }

  const uncreditedMinutes = earlyArrivalMinutes + lateDepartureMinutes;

  // --- human overrides -----------------------------------------------------
  const workedMinutes =
    resolution.manualWorkedMinutes != null
      ? Math.max(0, resolution.manualWorkedMinutes)
      : calculatedWorkedMinutes;
  const confirmedOtMinutes = Math.max(0, resolution.confirmedOtMinutes);
  const creditedWorkMinutes = workedMinutes + confirmedOtMinutes;
  const paidLeaveMinutes = Math.max(0, resolution.paidLeaveMinutes);
  const payableMinutes = creditedWorkMinutes + paidLeaveMinutes;

  // --- flagging ------------------------------------------------------------
  const needsManualDuration = hasIn !== hasOut && resolution.manualWorkedMinutes == null;

  if (hasIn !== hasOut) {
    // Spec 12.6: never assume a duration for a half-punched day.
    flags.push('INCOMPLETE_PUNCH');
  } else if (!hasIn && !hasOut) {
    if (expectedWorkingDay && !publicHoliday) flags.push('NO_PUNCH_ON_WORKING_DAY');
  } else if (creditedWorkMinutes !== PAY_RULES.standardWorkdayMinutes) {
    flags.push('NOT_STANDARD_DAY');
  }

  if (weeklyOff && (hasIn || hasOut)) flags.push('WORKED_ON_WEEKLY_OFF');

  // Pay caps punch-out at shift end, so excess time can never surface as
  // "more than 8 hours". Detect it from the raw punches instead, or overtime
  // would be invisible to the reviewer. See docs/RULE-DECISIONS.md.
  if (uncreditedMinutes > OVERTIME_REVIEW_THRESHOLD_MINUTES && confirmedOtMinutes === 0) {
    flags.push('POSSIBLE_OVERTIME');
  }

  const isFlagged = flags.length > 0;

  // --- punctuality ---------------------------------------------------------
  const punctualIn = inMinutes != null && inMinutes <= def.startMinutes + grace.lateArrival;
  const punctualOut = outMinutes != null && outMinutes >= def.endMinutes - grace.earlyDeparture;

  // Spec 12.8 condition 3 is "no unresolved/unoverridden discrepancy", so a day
  // a reviewer has actioned - confirmed overtime, an entered duration, a leave
  // tag - no longer blocks the bonus on its own.
  const blockingDiscrepancy = isFlagged && !resolution.resolved;

  const punctualityAwarded = resolution.grantPunctualityOverride
    ? true
    : punctualIn && punctualOut && !blockingDiscrepancy;

  return {
    date: input.date,
    schedule,
    status: input.status,
    isWeeklyOff: weeklyOff,
    isPublicHoliday: publicHoliday,
    isExpectedWorkingDay: expectedWorkingDay,
    rawInMinutes: inMinutes,
    rawOutMinutes: outMinutes,
    effectiveInMinutes: effectiveIn,
    effectiveOutMinutes: effectiveOut,
    spanMinutes,
    breakDeductions,
    breakMinutes,
    calculatedWorkedMinutes,
    workedMinutes,
    confirmedOtMinutes,
    creditedWorkMinutes,
    paidLeaveMinutes,
    payableMinutes,
    earlyArrivalMinutes,
    lateDepartureMinutes,
    uncreditedMinutes,
    deviationMinutes: creditedWorkMinutes - PAY_RULES.standardWorkdayMinutes,
    flags,
    isFlagged,
    isResolved: resolution.resolved,
    needsManualDuration,
    resolutionTag: resolution.tag,
    punctualIn,
    punctualOut,
    punctualityAwarded,
    meritAwarded: resolution.meritTicked,
  };
}

/** Stable per-day key: "YYYY-MM-DD" in local time. */
export const dayKey = isoDate;

/** Compute a whole month for one punch-based employee. */
export function computeMonth(
  days: DayInput[],
  schedule: ScheduleCode,
  resolutions: Map<string, DayResolution> = new Map(),
  grace: GraceMinutes = DEFAULT_GRACE,
): DayComputation[] {
  return days.map((day) =>
    computeDay(day, schedule, resolutions.get(dayKey(day.date)) ?? EMPTY_RESOLUTION, grace),
  );
}
