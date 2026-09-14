/**
 * Builds a synthetic biometric export that reproduces the layout quirks the
 * real device produces: a ten-row block per employee, day columns identified
 * only by their header text, and irregular spacer columns between them.
 */

import * as XLSX from 'xlsx';

const WEEKDAY = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'];

export interface FixtureDay {
  status?: string;
  inTime?: string;
  outTime?: string;
  duration?: string;
  shift?: string;
}

export interface FixtureEmployee {
  deviceId: string;
  name: string;
  summary?: string;
  /** Keyed by day of month. Days left out are rendered as absent. */
  days?: Record<number, FixtureDay>;
  /** Omit the labelled data rows entirely, to exercise the malformed path. */
  omitDataRows?: boolean;
}

/** Deliberately uneven column spacing, like the device's print layout. */
export function buildDayColumnMap(dayCount: number, startCol = 2): Map<number, number> {
  const map = new Map<number, number>();
  let col = startCol;
  for (let day = 1; day <= dayCount; day += 1) {
    map.set(day, col);
    col += day % 4 === 0 ? 3 : 2;
  }
  return map;
}

type Row = (string | null)[];

function blankRow(width: number): Row {
  return new Array(width).fill(null);
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface SheetOptions {
  year: number;
  month: number;
  dayCount: number;
  /**
   * 'slash' writes "01/07/2025 To 31/07/2025" in one cell.
   * 'named' reproduces the real device: "Jul 01 2026  To" and "Jul 31 2026" in
   * separate cells, with a "Printed On" stamp in the month AFTER the one the
   * report covers - the trap that made period detection pick August.
   */
  headerStyle?: 'slash' | 'named';
}

export function buildSheet(employees: FixtureEmployee[], options: SheetOptions): Row[] {
  const columns = buildDayColumnMap(options.dayCount);
  const width = Math.max(...columns.values()) + 2;
  const rows: Row[] = [];

  const push = (cells: Record<number, string | null>): Row => {
    const row = blankRow(width);
    for (const [col, value] of Object.entries(cells)) row[Number(col)] = value;
    rows.push(row);
    return row;
  };

  push({ 0: 'Monthly Status Report (Detailed Work Duration)' });

  if ((options.headerStyle ?? 'slash') === 'named') {
    const mon = MONTH_ABBR[options.month - 1];
    const printedMonth = MONTH_ABBR[options.month % 12];
    const printedYear = options.month === 12 ? options.year + 1 : options.year;
    push({ 17: `${mon} 01 ${options.year}  To  `, 22: `${mon} ${options.dayCount} ${options.year}` });
    push({ 0: 'Company:', 4: 'Default', 32: `Printed On : ${printedMonth} 28 ${printedYear} 16:26` });
  } else {
    push({ 0: 'ACME INDUSTRIES' });
    push({
      0: 'Department:',
      1: 'Default',
      4: `01/${String(options.month).padStart(2, '0')}/${options.year} To ${options.dayCount}/${String(options.month).padStart(2, '0')}/${options.year}`,
    });
  }
  rows.push(blankRow(width));

  // Day-column header row: "1 W", "2 Th", ...
  const header = blankRow(width);
  for (const [day, col] of columns) {
    const date = new Date(options.year, options.month - 1, day);
    header[col] = `${day} ${WEEKDAY[date.getDay()]}`;
  }
  rows.push(header);

  for (const employee of employees) {
    push({
      0: 'Employee:',
      1: `${employee.deviceId} : ${employee.name}`,
      5:
        employee.summary ??
        'Total Duration: 176:00 Hrs. Total OT: 00:00 Hrs. Present: 22 Absent: 0 WeeklyOff: 4 Holidays: 0 Leaves Taken: 0 Late By Hrs: 00:00 Late By Days: 0 Early By Hrs: 00:00 Early going By Days: 0',
    });

    if (employee.omitDataRows) {
      rows.push(blankRow(width));
      continue;
    }

    const dataRows: [string, (day: FixtureDay | undefined) => string | null][] = [
      ['Status', (d) => d?.status ?? 'A'],
      ['InTime', (d) => d?.inTime ?? '--:--'],
      ['OutTime', (d) => d?.outTime ?? '--:--'],
      ['Duration', (d) => d?.duration ?? '00:00'],
      ['Late By', () => '00:00'],
      ['Early By', () => '00:00'],
      ['OT', () => '00:00'],
      ['Shift', (d) => d?.shift ?? 'GS'],
    ];

    for (const [label, valueFor] of dataRows) {
      const row = blankRow(width);
      row[0] = label;
      for (const [day, col] of columns) {
        row[col] = valueFor(employee.days?.[day]);
      }
      rows.push(row);
    }

    rows.push(blankRow(width));
  }

  return rows;
}

/**
 * Serialise sheets to a workbook buffer. Tries legacy BIFF8 (.xls) first, since
 * that is what the device emits, and falls back to .xlsx if this build of
 * SheetJS cannot write BIFF8.
 */
export function buildWorkbookBuffer(sheets: Record<string, Row[]>): {
  buffer: Uint8Array;
  bookType: string;
} {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }

  for (const bookType of ['biff8', 'xlsx'] as const) {
    try {
      const buffer = XLSX.write(workbook, { type: 'array', bookType });
      return { buffer: new Uint8Array(buffer), bookType };
    } catch {
      // try the next format
    }
  }
  throw new Error('Could not serialise the fixture workbook.');
}
