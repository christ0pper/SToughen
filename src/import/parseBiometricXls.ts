/**
 * BIOMETRIC EXPORT PARSER
 *
 * Reads the device's "Monthly Status Report (Detailed Work Duration)" .xls
 * workbook into structured per-employee, per-day punch records.
 *
 * Deliberately defensive about layout, because the spec warns the shape varies:
 *   - every sheet is parsed, whatever the count or naming;
 *   - day columns are located by parsing each header cell's TEXT ("1 W", "2 Th"),
 *     never by fixed column position, since spacer columns shift the layout;
 *   - the ten rows of an employee block are located by their LABELS, not by
 *     fixed offsets from the "Employee:" row;
 *   - the device's own Duration / Late By / Early By / OT / Shift values are
 *     captured verbatim for reference and never fed into any calculation.
 *
 * Verified against a real 109-employee July export. What that file taught us,
 * and what the rules below therefore have to survive:
 *
 *   - Day columns are not contiguous. Merged spacer columns push July's 31 days
 *     across columns 2..38 with gaps at 4, 11, 16, 21, 25, 32. Only the header
 *     text can say which column is which day.
 *   - An employee enrolled without a name prints as "158 : 158". That is a real
 *     block and must not be mistaken for noise.
 *   - "Printed On : Aug 31 2026" sits in the same header as the reporting range
 *     "Jul 01 2026 To Jul 31 2026". Reading the month off the wrong one would
 *     silently import a month of attendance against the wrong period.
 *   - Status codes seen: P, A, WO, WOP and the vulgar-fraction half day. Shift
 *     codes seen: GS, NS and "Sam". Shift is the device's own label for its
 *     roster and is NOT the schedule this payroll pays against - see
 *     docs/RULE-DECISIONS.md.
 */

import * as XLSX from 'xlsx';
import { normalizeStatus, type StatusCode } from '@/domain/config';
import { parseClock } from '@/domain/time';

export interface ParsedDay {
  day: number;
  statusRaw: string | null;
  status: StatusCode;
  inTimeRaw: string | null;
  outTimeRaw: string | null;
  inMinutes: number | null;
  outMinutes: number | null;
  /** Captured for audit/reference only - never used in any calculation. */
  deviceDurationRaw: string | null;
  deviceShiftRaw: string | null;
}

export interface ParsedEmployeeBlock {
  sheetName: string;
  /** 0-based row index of the "Employee:" row, for error reporting. */
  rowIndex: number;
  deviceId: string;
  name: string;
  /** The device's own report footer text. Reference only. */
  deviceSummaryRaw: string | null;
  days: ParsedDay[];
  /** True when the block had no usable Status/InTime/OutTime rows. */
  incomplete: boolean;
  /** The device held no name for this ID and printed the ID instead. */
  unnamed: boolean;
}

export interface ParsedSheetInfo {
  name: string;
  employeeCount: number;
  dayColumnCount: number;
}

export interface ParseResult {
  employees: ParsedEmployeeBlock[];
  sheets: ParsedSheetInfo[];
  /** Best-effort only. Always have the uploader confirm the period. */
  detectedPeriod: { year: number; month: number } | null;
  /** Highest day number any sheet carried, for checking against the month. */
  maxDay: number;
  /** Distinct device shift labels seen, so the importer can report them. */
  shiftCodes: string[];
  warnings: string[];
}

type Row = (string | null)[];

const DAY_HEADER_RE = /^(\d{1,2})\s*([A-Za-z]{1,3})?$/;
const EMPLOYEE_RE = /^(\d+)\s*:\s*(.+)$/;
const MIN_DAY_COLUMNS = 20;

const MONTH_NAMES = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

function cellText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** Lowercase, alphanumerics only - so "Late By" and "LateBy" match. */
function labelKey(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Locate every day-column header row and the day -> column index map it defines.
 * A sheet spanning several print pages repeats this header, so all of them are
 * kept and each employee block uses the nearest one above it.
 */
export function findDayHeaderRows(rows: Row[]): { rowIndex: number; dayColumns: Map<number, number> }[] {
  const found: { rowIndex: number; dayColumns: Map<number, number> }[] = [];

  rows.forEach((row, rowIndex) => {
    if (!row) return;
    const dayColumns = new Map<number, number>();

    row.forEach((cell, colIndex) => {
      const text = cellText(cell);
      if (!text) return;
      const match = DAY_HEADER_RE.exec(text);
      if (!match) return;
      const day = Number(match[1]);
      if (day < 1 || day > 31) return;
      // First column wins, so a repeated day number cannot shift the mapping.
      if (!dayColumns.has(day)) dayColumns.set(day, colIndex);
    });

    if (dayColumns.size >= MIN_DAY_COLUMNS) {
      found.push({ rowIndex, dayColumns });
    }
  });

  return found;
}

function dayColumnsFor(
  headers: { rowIndex: number; dayColumns: Map<number, number> }[],
  employeeRowIndex: number,
): Map<number, number> | null {
  let best: Map<number, number> | null = null;
  for (const header of headers) {
    if (header.rowIndex < employeeRowIndex) best = header.dayColumns;
    else break;
  }
  return best ?? (headers.length > 0 ? headers[0].dayColumns : null);
}

interface EmployeeRow {
  rowIndex: number;
  deviceId: string;
  name: string;
  summary: string | null;
  /** The device holds no name for this ID, so it printed the ID as the name. */
  unnamed: boolean;
}

/** Row indices of every "Employee:" block header in the sheet. */
function findEmployeeRows(rows: Row[]): EmployeeRow[] {
  const found: EmployeeRow[] = [];

  rows.forEach((row, rowIndex) => {
    if (!row) return;

    const hasEmployeeLabel = row.some((cell) => labelKey(cell) === 'employee');
    let identity: { deviceId: string; name: string; column: number } | null = null;

    for (let col = 0; col < row.length; col += 1) {
      const text = cellText(row[col]);
      if (!text) continue;
      const match = EMPLOYEE_RE.exec(text);
      if (!match) continue;
      const name = match[2].trim();
      // A punch pair reads as "12 : 30", so away from the "Employee:" label a
      // name has to contain letters. On a labelled row it does not: a device
      // with no name enrolled for an ID prints that ID as the name, and
      // "158 : 158" is a real person whose block must not be thrown away.
      if (!hasEmployeeLabel && !/[A-Za-z]/.test(name)) continue;
      identity = { deviceId: match[1], name, column: col };
      break;
    }

    if (!identity) return;
    // Without the label, only accept the row if it looks unambiguously like a block header.
    if (!hasEmployeeLabel && !/^[A-Z][A-Za-z .'-]*$/.test(identity.name)) return;

    const summary =
      row
        .slice(identity.column + 1)
        .map(cellText)
        .find((text) => text != null && /total duration/i.test(text)) ?? null;

    found.push({
      rowIndex,
      deviceId: identity.deviceId,
      name: identity.name,
      summary,
      unnamed: !/[A-Za-z]/.test(identity.name),
    });
  });

  return found;
}

/** Map the labelled rows of one employee block to their row indices. */
function findBlockRows(rows: Row[], startRow: number, endRow: number): Map<string, number> {
  const wanted = new Set(['status', 'intime', 'outtime', 'duration', 'lateby', 'earlyby', 'ot', 'shift']);
  const result = new Map<string, number>();

  for (let rowIndex = startRow + 1; rowIndex < endRow; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;
    // The label sits in one of the leading columns, before the day columns start.
    for (let col = 0; col < Math.min(row.length, 8); col += 1) {
      const key = labelKey(row[col]);
      if (wanted.has(key) && !result.has(key)) {
        result.set(key, rowIndex);
        break;
      }
    }
  }

  return result;
}

/**
 * The report header, as one string, with the print timestamp removed.
 *
 * "Printed On : Aug 31 2026" is when someone ran the report, not what it
 * covers, and a July report is normally printed in August - so leaving it in
 * makes the wrong month the easiest one to match. Only rows above the first
 * employee block are considered, so no employee's summary line can contribute.
 */
function headerText(rows: Row[]): string {
  let limit = rows.length;
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    if ((rows[i] ?? []).some((cell) => labelKey(cell) === 'employee')) {
      limit = i;
      break;
    }
  }

  return rows
    .slice(0, Math.min(limit, 20))
    .flatMap((row) => (row ?? []).map(cellText))
    .filter((text): text is string => text != null)
    .join(' | ')
    .replace(/printed\s*on\s*:?[^|]*/gi, ' ');
}

function monthFromName(name: string): number {
  return MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/**
 * Every date in the report header, in the order it appears.
 *
 * The device writes its range as "Jul 01 2026 To Jul 31 2026" in one file and
 * "01/07/2025 To 31/07/2025" in another, so both are read. Slash dates are
 * day-first, which is how the device is configured here.
 */
export function detectPeriodRange(rows: Row[]): { year: number; month: number }[] {
  const haystack = headerText(rows);
  const found: { year: number; month: number }[] = [];

  const dmy = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g;
  for (const match of haystack.matchAll(dmy)) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) found.push({ year: Number(match[3]), month });
  }
  if (found.length > 0) return found;

  // "Jul 01 2026" / "July 1, 2026"
  const mdy = /\b([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s+(\d{4})\b/g;
  for (const match of haystack.matchAll(mdy)) {
    const month = monthFromName(match[1]);
    if (month >= 1) found.push({ year: Number(match[3]), month });
  }
  if (found.length > 0) return found;

  // "Jul-2025" / "July 2025"
  const my = /\b([A-Za-z]{3,9})[\s-]+(\d{4})\b/g;
  for (const match of haystack.matchAll(my)) {
    const month = monthFromName(match[1]);
    if (month >= 1) found.push({ year: Number(match[2]), month });
  }

  return found;
}

/** Best-effort period detection from the report header. Always confirm with the user. */
export function detectPeriod(rows: Row[]): { year: number; month: number } | null {
  return detectPeriodRange(rows)[0] ?? null;
}

export function parseBiometricWorkbook(data: ArrayBuffer | Buffer | Uint8Array): ParseResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false });

  const employees: ParsedEmployeeBlock[] = [];
  const sheets: ParsedSheetInfo[] = [];
  const warnings: string[] = [];
  const shiftCodes = new Set<string>();
  let maxDay = 0;
  let detectedPeriod: { year: number; month: number } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const rows = XLSX.utils.sheet_to_json<Row>(worksheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: true,
    });

    if (detectedPeriod == null) {
      const range = detectPeriodRange(rows);
      detectedPeriod = range[0] ?? null;

      // A report whose two ends fall in different months cannot be read as one
      // payroll month, and guessing which end wins would be the wrong kind of
      // helpful. Say so and let the uploader choose.
      const distinct = new Set(range.map((r) => `${r.year}-${r.month}`));
      if (distinct.size > 1) {
        warnings.push(
          `The report header covers more than one month (${[...distinct].join(', ')}). Check you have selected the right payroll period.`,
        );
      }
    }

    const headers = findDayHeaderRows(rows);
    const employeeRows = findEmployeeRows(rows);

    if (headers.length === 0) {
      warnings.push(
        `Sheet "${sheetName}": no day-column header row found (expected cells like "1 W", "2 Th"). Its ${employeeRows.length} employee block(s) were skipped.`,
      );
      sheets.push({ name: sheetName, employeeCount: 0, dayColumnCount: 0 });
      continue;
    }

    let sheetEmployeeCount = 0;

    employeeRows.forEach((employee, index) => {
      const nextRow = employeeRows[index + 1]?.rowIndex ?? rows.length;
      const blockRows = findBlockRows(rows, employee.rowIndex, nextRow);
      const dayColumns = dayColumnsFor(headers, employee.rowIndex);

      const statusRow = blockRows.get('status');
      const inRow = blockRows.get('intime');
      const outRow = blockRows.get('outtime');
      const durationRow = blockRows.get('duration');
      const shiftRow = blockRows.get('shift');

      const incomplete = dayColumns == null || (statusRow == null && inRow == null && outRow == null);

      if (incomplete) {
        warnings.push(
          `Sheet "${sheetName}" row ${employee.rowIndex + 1}: block for device ID ${employee.deviceId} (${employee.name}) has no readable Status/InTime/OutTime rows.`,
        );
      }

      const days: ParsedDay[] = [];

      if (dayColumns) {
        const sortedDays = [...dayColumns.keys()].sort((a, b) => a - b);
        for (const day of sortedDays) {
          const col = dayColumns.get(day)!;
          const at = (rowIndex: number | undefined): string | null =>
            rowIndex == null ? null : cellText(rows[rowIndex]?.[col]);

          const statusRaw = at(statusRow);
          const inTimeRaw = at(inRow);
          const outTimeRaw = at(outRow);

          if (day > maxDay) maxDay = day;
          const shift = at(shiftRow);
          if (shift) shiftCodes.add(shift);

          days.push({
            day,
            statusRaw,
            status: normalizeStatus(statusRaw),
            inTimeRaw,
            outTimeRaw,
            inMinutes: parseClock(inTimeRaw),
            outMinutes: parseClock(outTimeRaw),
            deviceDurationRaw: at(durationRow),
            deviceShiftRaw: shift,
          });
        }
      }

      employees.push({
        sheetName,
        rowIndex: employee.rowIndex,
        deviceId: employee.deviceId,
        name: employee.name,
        deviceSummaryRaw: employee.summary,
        days,
        incomplete,
        unnamed: employee.unnamed,
      });
      sheetEmployeeCount += 1;
    });

    sheets.push({
      name: sheetName,
      employeeCount: sheetEmployeeCount,
      dayColumnCount: headers[0]?.dayColumns.size ?? 0,
    });
  }

  // An unnamed enrolment still holds real punches, so it is imported - but it
  // arrives as a bare number and nobody can match it to a person from that
  // alone, so it has to be called out rather than quietly queued.
  const unnamed = employees.filter((employee) => employee.unnamed);
  if (unnamed.length > 0) {
    warnings.push(
      `${unnamed.length} enrolment(s) have no name on the device and print as their own ID (${unnamed
        .map((employee) => employee.deviceId)
        .join(', ')}). Their punches were read; match them to an employee before approving.`,
    );
  }

  // Duplicate device IDs across sheets would silently merge two people's data.
  const seen = new Map<string, string>();
  for (const employee of employees) {
    const previous = seen.get(employee.deviceId);
    if (previous && previous !== employee.sheetName) {
      warnings.push(
        `Device ID ${employee.deviceId} appears in both "${previous}" and "${employee.sheetName}". Confirm they are the same person before importing.`,
      );
    }
    seen.set(employee.deviceId, employee.sheetName);
  }

  if (employees.length === 0) {
    warnings.push('No employee blocks were found. Check that this is the biometric monthly status report.');
  }

  return {
    employees,
    sheets,
    detectedPeriod,
    maxDay,
    shiftCodes: [...shiftCodes].sort(),
    warnings,
  };
}
