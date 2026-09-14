/**
 * COMPANY RULE CONFIGURATION
 *
 * Every business rule from the product spec lives here as data, so a policy
 * change is a value edit rather than a code change. Anything marked
 * `SPEC AMBIGUITY` is an interpretation that needs the product owner's
 * confirmation - see docs/RULE-DECISIONS.md.
 */

export type ScheduleCode = 'OS' | 'PS' | 'NS';
export type ExceptionRole = 'SALESMAN' | 'MANAGER' | 'SECURITY' | 'DRIVER';

export interface ScheduleDef {
  code: ScheduleCode;
  label: string;
  /** Minutes from midnight. */
  startMinutes: number;
  /** Minutes from midnight; exceeds 1440 when the shift crosses midnight. */
  endMinutes: number;
  spansMidnight: boolean;
  /** NS gets no break deduction - its shift never overlaps the daytime windows. */
  breaksApply: boolean;
}

const H = (h: number, m = 0) => h * 60 + m;

export const SCHEDULES: Record<ScheduleCode, ScheduleDef> = {
  OS: {
    code: 'OS',
    label: 'Office Staff',
    startMinutes: H(9),
    endMinutes: H(18),
    spansMidnight: false,
    breaksApply: true,
  },
  PS: {
    code: 'PS',
    label: 'Plant Staff',
    startMinutes: H(8),
    endMinutes: H(17),
    spansMidnight: false,
    breaksApply: true,
  },
  NS: {
    code: 'NS',
    label: 'Night Staff',
    startMinutes: H(22),
    endMinutes: H(30), // 06:00 the next day
    spansMidnight: true,
    breaksApply: false,
  },
};

/** Exception roles reference a schedule for classification only - never for pay. */
export const EXCEPTION_ROLE_SCHEDULE: Record<ExceptionRole, ScheduleCode> = {
  SALESMAN: 'OS',
  MANAGER: 'OS',
  SECURITY: 'PS',
  DRIVER: 'PS',
};

export interface BreakDef {
  key: 'BREAKFAST' | 'LUNCH' | 'TEA';
  label: string;
  durationMinutes: number;
  /** The policy window the break must fall inside. */
  windowStart: number;
  windowEnd: number;
  /**
   * Assumed start of the break, per schedule. PS takes theirs in the first half
   * of the window, OS in the second half (spec 12.2 - an explicit rule of thumb,
   * not an enforced punch slot). Only the overlap with the worked span matters.
   */
  slotStart: Record<'OS' | 'PS', number>;
}

export const BREAKS: BreakDef[] = [
  {
    key: 'BREAKFAST',
    label: 'Breakfast',
    durationMinutes: 15,
    windowStart: H(9),
    windowEnd: H(11),
    slotStart: { PS: H(9), OS: H(10) },
  },
  {
    key: 'LUNCH',
    label: 'Lunch',
    durationMinutes: 30,
    windowStart: H(12),
    windowEnd: H(14),
    slotStart: { PS: H(12), OS: H(13) },
  },
  {
    key: 'TEA',
    label: 'Tea',
    durationMinutes: 15,
    windowStart: H(15, 45),
    windowEnd: H(16, 30),
    slotStart: { PS: H(15, 45), OS: H(16, 15) },
  },
];

/** Read a minutes value from the environment, falling back to the built-in default. */
function envMinutes(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 120 ? value : fallback;
}

export const ROUNDING = {
  /**
   * Early arrival is never credited (spec 12.3 bullet 1). Applied without limit:
   * punching in 45 minutes early is still rounded to shift start, exactly as
   * punching out 45 minutes late is capped at shift end (bullet 4).
   */
  creditEarlyArrival: false,
  /** Late departure is capped at shift end "regardless" (spec 12.3 bullet 4). */
  creditLateDeparture: false,

  /**
   * SPEC AMBIGUITY (the single most consequential one in the build).
   * Spec 12.3 grants an explicit 30-minute grace only on the two sides that
   * would ADD hours (early in, late out). Bullet 3 then mentions "early
   * departure or late arrival beyond grace", implying a grace on the two sides
   * that REDUCE hours too - but no such grace is ever defined.
   *
   * Built with 0 (strict): any lateness or early departure reduces payable
   * hours and therefore trips the "not exactly 8 hours" flag for human review.
   * This matches the document's stated intent to surface everything rather than
   * silently absorb it.
   *
   * Switch to the lenient reading without a code change by setting
   * PAYROLL_LATE_ARRIVAL_GRACE_MINUTES / PAYROLL_EARLY_DEPARTURE_GRACE_MINUTES
   * to 30 in the environment. The strict reading flags most days on realistic
   * data; measure both against a real export before deciding.
   */
  lateArrivalGraceMinutes: envMinutes('PAYROLL_LATE_ARRIVAL_GRACE_MINUTES', 0),
  earlyDepartureGraceMinutes: envMinutes('PAYROLL_EARLY_DEPARTURE_GRACE_MINUTES', 0),
} as const;

export const PAY_RULES = {
  standardWorkdayMinutes: 480, // exactly 8 hours, excluding breaks
  punctualityRatePerHour: 5, // INR per worked hour
  meritRatePerHour: 5, // INR per worked hour
  holidayPaidHours: 8,
  holidayTenureDays: 365,
  esiRate: 0.0075, // 0.75% of gross
  pfRate: 0.12, // 12% of gross...
  pfCapAmount: 1800, // ...capped at INR 1800
  /** No default. Admin sets this explicitly - never hardcode a statutory figure. */
  esiWageThresholdDefault: null as number | null,
} as const;

/** Status codes as they appear in the biometric export. */
export type StatusCode = 'P' | 'A' | 'HALF_P' | 'WO' | 'WOP' | 'UNKNOWN';

export function normalizeStatus(raw: unknown): StatusCode {
  if (raw == null) return 'UNKNOWN';
  const s = String(raw).trim().toUpperCase();
  if (s === 'P') return 'P';
  if (s === 'A') return 'A';
  if (s === 'WO') return 'WO';
  if (s === 'WOP') return 'WOP';
  // The device writes half-day as "1/2P" or the vulgar-fraction "½P".
  if (s === '½P' || s === '1/2P' || s === '0.5P' || s === 'HP') return 'HALF_P';
  return 'UNKNOWN';
}
