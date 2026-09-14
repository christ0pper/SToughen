import { describe, expect, it } from 'vitest';
import {
  detectPeriod,
  detectPeriodRange,
  findDayHeaderRows,
  parseBiometricWorkbook,
} from '@/import/parseBiometricXls';
import { parseClock } from '@/domain/time';
import { buildSheet, buildWorkbookBuffer, type FixtureEmployee } from './fixtures/buildWorkbook';

const JULY = { year: 2025, month: 7, dayCount: 31 };

const SHEET1: FixtureEmployee[] = [
  {
    deviceId: '2',
    name: 'BALKISHORE RAM',
    days: {
      1: { status: 'P', inTime: '08:58', outTime: '18:04', duration: '09:06' },
      2: { status: 'P', inTime: '09:14', outTime: '18:00', duration: '08:46' },
      // Missed punch-out - the ~8.5% anomaly class in the real data.
      3: { status: 'P', inTime: '08:55', outTime: '--:--', duration: '00:00' },
      4: { status: 'A' },
      5: { status: 'WOP', inTime: '09:00', outTime: '18:00', duration: '09:00' },
      6: { status: 'WO' },
    },
  },
  {
    deviceId: '17',
    name: 'SUNIL KUMAR',
    // A night-shift punch pattern the device still labels "GS".
    days: {
      1: { status: 'P', inTime: '22:00', outTime: '06:00', duration: '08:00', shift: 'GS' },
      2: { status: 'P', inTime: '21:58', outTime: '06:02', duration: '08:04', shift: 'GS' },
    },
  },
];

const SHEET2: FixtureEmployee[] = [
  { deviceId: '104', name: 'RAJESH SINGH', days: { 1: { status: 'P', inTime: '08:00', outTime: '17:00' } } },
  { deviceId: '105', name: 'MEENA DEVI', omitDataRows: true },
];

function parseFixture() {
  const { buffer, bookType } = buildWorkbookBuffer({
    Sheet1: buildSheet(SHEET1, JULY),
    Sheet2: buildSheet(SHEET2, JULY),
  });
  return { result: parseBiometricWorkbook(buffer), bookType };
}

describe('workbook structure', () => {
  it('parses every sheet, whatever the count or naming', () => {
    const { result } = parseFixture();
    expect(result.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet2']);
    expect(result.sheets[0].employeeCount).toBe(2);
    expect(result.sheets[1].employeeCount).toBe(2);
    expect(result.employees).toHaveLength(4);
  });

  it('round-trips through the legacy .xls binary format', () => {
    const { bookType } = parseFixture();
    expect(bookType).toBe('biff8');
  });

  it('splits the "<DeviceID> : <NAME>" cell', () => {
    const { result } = parseFixture();
    const employee = result.employees[0];
    expect(employee.deviceId).toBe('2');
    expect(employee.name).toBe('BALKISHORE RAM');
    expect(employee.deviceSummaryRaw).toMatch(/Total Duration/);
  });

  it('detects the period from the report header', () => {
    const { result } = parseFixture();
    expect(result.detectedPeriod).toEqual({ year: 2025, month: 7 });
  });
});

describe('day columns', () => {
  it('locates all 31 days despite irregular spacer columns', () => {
    const { result } = parseFixture();
    expect(result.sheets[0].dayColumnCount).toBe(31);
    expect(result.employees[0].days).toHaveLength(31);
    expect(result.employees[0].days.map((d) => d.day)).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1),
    );
  });

  it('reads day numbers from the header text, not the column position', () => {
    const rows = buildSheet(SHEET1, JULY);
    const headers = findDayHeaderRows(rows);
    expect(headers).toHaveLength(1);
    const columns = headers[0].dayColumns;
    // Spacing widens every fourth day, so positions are not a fixed stride.
    expect(columns.get(2)! - columns.get(1)!).toBe(2);
    expect(columns.get(5)! - columns.get(4)!).toBe(3);
  });

  it('ignores the data rows when looking for the header', () => {
    const rows = buildSheet(SHEET1, JULY);
    const headerRowIndex = findDayHeaderRows(rows)[0].rowIndex;
    expect(rows[headerRowIndex][0]).toBeNull();
  });
});

describe('per-day values', () => {
  it('parses status, in and out times into minutes', () => {
    const { result } = parseFixture();
    const days = result.employees[0].days;
    const first = days.find((d) => d.day === 1)!;
    expect(first.status).toBe('P');
    expect(first.inMinutes).toBe(8 * 60 + 58);
    expect(first.outMinutes).toBe(18 * 60 + 4);
  });

  it('treats the placeholder as a missing punch, not midnight', () => {
    const { result } = parseFixture();
    const third = result.employees[0].days.find((d) => d.day === 3)!;
    expect(third.inMinutes).toBe(8 * 60 + 55);
    expect(third.outTimeRaw).toBe('--:--');
    expect(third.outMinutes).toBeNull();
  });

  it('carries the WO and WOP codes through unchanged for the engine to reinterpret', () => {
    const { result } = parseFixture();
    const days = result.employees[0].days;
    expect(days.find((d) => d.day === 5)!.status).toBe('WOP');
    expect(days.find((d) => d.day === 6)!.status).toBe('WO');
    expect(days.find((d) => d.day === 4)!.status).toBe('A');
  });

  it('captures the device columns for reference without trusting them', () => {
    const { result } = parseFixture();
    const nightShifter = result.employees[1];
    const first = nightShifter.days.find((d) => d.day === 1)!;
    // The device calls a 22:00-06:00 pattern "GS". We keep the label, and ignore it.
    expect(first.deviceShiftRaw).toBe('GS');
    expect(first.deviceDurationRaw).toBe('08:00');
    expect(first.inMinutes).toBe(22 * 60);
    expect(first.outMinutes).toBe(6 * 60);
  });
});

describe('malformed input', () => {
  it('flags a block with no readable data rows instead of dropping it', () => {
    const { result } = parseFixture();
    const broken = result.employees.find((e) => e.deviceId === '105')!;
    expect(broken.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/105|MEENA DEVI/);
  });

  it('warns when a workbook contains no employee blocks', () => {
    const { buffer } = buildWorkbookBuffer({ Sheet1: [['nothing', 'useful']] });
    const result = parseBiometricWorkbook(buffer);
    expect(result.employees).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/no employee blocks/i);
  });

  it('warns when the same device ID turns up on two sheets', () => {
    const duplicate: FixtureEmployee[] = [{ deviceId: '2', name: 'SOMEONE ELSE' }];
    const { buffer } = buildWorkbookBuffer({
      Sheet1: buildSheet(SHEET1, JULY),
      Sheet2: buildSheet(duplicate, JULY),
    });
    const result = parseBiometricWorkbook(buffer);
    expect(result.warnings.join(' ')).toMatch(/Device ID 2 appears in both/);
  });
});

describe('clock parsing', () => {
  it.each([
    ['09:00', 540],
    ['9:00', 540],
    ['22:30', 1350],
    ['06:00', 360],
    ['00:00', 0],
  ])('parses %s', (input, expected) => {
    expect(parseClock(input)).toBe(expected);
  });

  it.each(['--:--', '', '-', null, undefined, 'garbage'])('returns null for %s', (input) => {
    expect(parseClock(input)).toBeNull();
  });

  it('accepts an Excel serial fraction', () => {
    expect(parseClock(0.5)).toBe(720);
  });
});

describe('period detection', () => {
  it('reads a day-first date range', () => {
    expect(detectPeriod([['Report for 01/07/2025 To 31/07/2025']])).toEqual({
      year: 2025,
      month: 7,
    });
  });

  it('reads a named month', () => {
    expect(detectPeriod([['Payroll month: July 2025']])).toEqual({ year: 2025, month: 7 });
  });

  it('returns null rather than guessing', () => {
    expect(detectPeriod([['no dates here']])).toBeNull();
  });
});

/**
 * Everything below was found by reading a real 109-employee July export rather
 * than by imagining what a device might do. Each case cost real rows the first
 * time round, so each one has a test.
 */
describe('quirks of the real device export', () => {
  const JULY_2026 = { year: 2026, month: 7, dayCount: 31, headerStyle: 'named' as const };

  function parseNamedHeader(employees: FixtureEmployee[]) {
    const { buffer } = buildWorkbookBuffer({ Sheet1: buildSheet(employees, JULY_2026) });
    return parseBiometricWorkbook(buffer);
  }

  it('reads the month off the reporting range, not the "Printed On" stamp', () => {
    // The report covers July but is printed in August. Matching the wrong line
    // would import a month of attendance against the wrong period.
    const result = parseNamedHeader([{ deviceId: '2', name: 'BALKISHORE RAM' }]);
    expect(result.detectedPeriod).toEqual({ year: 2026, month: 7 });
  });

  it('keeps an enrolment the device never named', () => {
    // A device with no name for an ID prints "158 : 158". That is a real person
    // with real punches, and dropping the block loses their whole month.
    const result = parseNamedHeader([
      { deviceId: '2', name: 'BALKISHORE RAM' },
      { deviceId: '158', name: '158', days: { 1: { status: 'P', inTime: '22:00', outTime: '06:00', shift: 'NS' } } },
    ]);

    expect(result.employees.map((e) => e.deviceId)).toEqual(['2', '158']);

    const unnamed = result.employees.find((e) => e.deviceId === '158')!;
    expect(unnamed.unnamed).toBe(true);
    expect(unnamed.days.find((d) => d.day === 1)?.inMinutes).toBe(22 * 60);
  });

  it('names the unnamed enrolments in a warning rather than passing them off as people', () => {
    const result = parseNamedHeader([
      { deviceId: '158', name: '158' },
      { deviceId: '159', name: '159' },
    ]);
    expect(result.warnings.join(' ')).toMatch(/no name on the device/i);
    expect(result.warnings.join(' ')).toContain('158, 159');
  });

  it('still refuses to read a punch pair as an employee', () => {
    // "12 : 30" on an InTime row must not become device 12 named "30". The
    // relaxation above applies only to a row carrying the "Employee:" label.
    const result = parseNamedHeader([
      { deviceId: '2', name: 'BALKISHORE RAM', days: { 1: { status: 'P', inTime: '12:30', outTime: '21:30' } } },
    ]);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].deviceId).toBe('2');
  });

  it('reports the day span and the device shift labels it saw', () => {
    const result = parseNamedHeader([
      { deviceId: '16', name: 'JOBY MICHEL', days: { 1: { status: 'P', shift: 'Sam' } } },
      { deviceId: '157', name: 'SAMUAL P O', days: { 1: { status: 'P', shift: 'NS' } } },
    ]);
    expect(result.maxDay).toBe(31);
    // "Sam" and "NS" are the device's roster names, surfaced but never mapped.
    expect(result.shiftCodes).toEqual(['GS', 'NS', 'Sam']);
  });

  it('carries the vulgar-fraction half day through', () => {
    const result = parseNamedHeader([
      { deviceId: '9', name: 'SEEMA BABY', days: { 20: { status: '\u00bdP', inTime: '07:55', outTime: '13:03' } } },
    ]);
    const day = result.employees[0].days.find((d) => d.day === 20)!;
    expect(day.statusRaw).toBe('\u00bdP');
    expect(day.status).toBe('HALF_P');
  });

  it('keeps a cross-midnight pair as two clock readings, not a negative span', () => {
    // 590 days in the real file punch out before they punch in. The parser
    // reports both clocks and leaves the spanning to the hours engine.
    const result = parseNamedHeader([
      { deviceId: '2', name: 'BALKISHORE RAM', days: { 1: { status: 'P', inTime: '20:46', outTime: '07:16' } } },
    ]);
    const day = result.employees[0].days.find((d) => d.day === 1)!;
    expect(day.inMinutes).toBe(20 * 60 + 46);
    expect(day.outMinutes).toBe(7 * 60 + 16);
  });

  it('warns when the header covers more than one month', () => {
    const rows = [
      ['Monthly Status Report (Detailed Work Duration)'],
      [null, 'Jun 26 2026  To  ', null, 'Jul 25 2026'],
    ];
    expect(detectPeriodRange(rows)).toEqual([
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
    ]);
  });

  it('ignores a print stamp even when it is the only date left', () => {
    const rows = [
      ['Monthly Status Report (Detailed Work Duration)'],
      [null, 'Printed On : Aug 31 2026 16:26'],
    ];
    expect(detectPeriod(rows)).toBeNull();
  });
});
