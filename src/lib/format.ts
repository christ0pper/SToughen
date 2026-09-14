/** Display helpers shared by the screens, payslips and exports. */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

export function periodLabel(year: number, month: number): string {
  return `${monthName(month)} ${year}`;
}

/** Indian digit grouping, two decimals. The rupee sign is added by the caller. */
export function money(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function rupees(amount: number): string {
  return `₹${money(amount)}`;
}

export function hours(value: number): string {
  return value.toFixed(2);
}

export function shortDate(date: Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', weekday: 'short' }).format(date);
}

export function dateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const FLAG_LABELS: Record<string, string> = {
  NOT_STANDARD_DAY: 'Not 8 hours',
  INCOMPLETE_PUNCH: 'Missing punch',
  NO_PUNCH_ON_WORKING_DAY: 'Absent',
  POSSIBLE_OVERTIME: 'Overtime to review',
  WORKED_ON_WEEKLY_OFF: 'Worked Sunday',
};

export const RESOLUTION_LABELS: Record<string, string> = {
  SANCTIONED_LEAVE: 'Sanctioned leave',
  UNAUTHORIZED_ABSENCE: 'Unauthorised absence',
  HALF_DAY: 'Half day',
  OTHER: 'Other',
};

export const SCHEDULE_LABELS: Record<string, string> = {
  OS: 'Office Staff (09:00-18:00)',
  PS: 'Plant Staff (08:00-17:00)',
  NS: 'Night Staff (22:00-06:00)',
  EXCEPTION: 'Exception role (manual hours)',
};

/** Short readable schedule name. "PS" means nothing to someone new. */
export function scheduleName(scheduleType: string, exceptionRole?: string | null): string {
  if (scheduleType === 'EXCEPTION') {
    const role = exceptionRole ? exceptionRole.toLowerCase() : 'manual hours';
    return `Exception · ${role.charAt(0).toUpperCase()}${role.slice(1)}`;
  }
  return { OS: 'Office', PS: 'Plant', NS: 'Night' }[scheduleType] ?? scheduleType;
}

/** The shift the schedule runs, for a secondary line. */
export function scheduleHours(scheduleType: string): string {
  return { OS: '09:00-18:00', PS: '08:00-17:00', NS: '22:00-06:00' }[scheduleType] ?? 'manual hours';
}

/**
 * Up to two initials from a display name.
 *
 * Letters only, so "Owner (Admin)" initialises to "OA" rather than "O(".
 */
export function initialsOf(name: string): string {
  return name
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** A pay entry as a person reads it: "₹82.00/hr" or "₹66,000.00/month". */
export function payLabel(
  entry: { payBasis?: string | null; hourlyRate: number; monthlySalary?: number | null } | null | undefined,
): string {
  if (!entry) return 'not set';
  return entry.payBasis === 'MONTHLY'
    ? `${rupees(entry.monthlySalary ?? 0)}/month`
    : `${rupees(entry.hourlyRate)}/hr`;
}
