/**
 * Time helpers. All times are represented as integer MINUTES FROM MIDNIGHT.
 * Values may exceed 1440 to represent a time on the following day (used for
 * night-shift spans that cross midnight).
 */

export const MINUTES_PER_DAY = 1440;

/** Tokens the biometric export uses for "no punch". Extend once a real file confirms more. */
export const NULL_TIME_TOKENS = new Set(['', '-', '--', '--:--', '-:-', 'n/a', 'na', 'null']);

/**
 * Parse a punch value into minutes-from-midnight.
 * Accepts "HH:MM" / "H:MM" strings, Excel serial fractions (0..1), and Date objects,
 * because SheetJS may hand back any of the three depending on the cell format.
 * Returns null for blanks and the device's placeholder tokens.
 */
export function parseClock(value: unknown): number | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Excel time-of-day cells arrive as a fraction of a day.
    const frac = value - Math.floor(value);
    if (value >= 0 && value < 1) return Math.round(value * MINUTES_PER_DAY);
    return Math.round(frac * MINUTES_PER_DAY);
  }

  const raw = String(value).trim();
  if (NULL_TIME_TOKENS.has(raw.toLowerCase())) return null;

  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;

  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 47 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/** Format minutes-from-midnight back to "HH:MM" (wrapping past midnight). */
export function formatClock(minutes: number | null): string {
  if (minutes == null) return '--:--';
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format a duration in minutes as "H:MM" (no midnight wrap). */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** Minutes -> hours, rounded to 4dp to keep money maths free of float noise. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10000) / 10000;
}

/** Overlap in minutes between two half-open intervals [aStart, aEnd) and [bStart, bEnd). */
export function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * "YYYY-MM-DD" in LOCAL time.
 *
 * Never use toISOString() for a calendar date: dates here are local midnight,
 * and toISOString() converts to UTC, reporting the previous day everywhere east
 * of Greenwich (IST included).
 */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 0 = Sunday .. 6 = Saturday, in local time. */
export function dayOfWeek(date: Date): number {
  return date.getDay();
}

export function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

export function isSaturday(date: Date): boolean {
  return date.getDay() === 6;
}

/** Whole days between two dates, ignoring time-of-day. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/** Build a local Date for a given year/month(1-12)/day. */
export function makeDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
