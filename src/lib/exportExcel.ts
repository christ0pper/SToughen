/**
 * Excel export of the all-employee summary report.
 *
 * Money lands in the sheet as real numbers with a currency format, not
 * pre-formatted text, so the recipient can sum and filter it.
 */

import * as XLSX from 'xlsx';
import { periodLabel } from './format';
import type { SummaryRow } from '@/services/reportService';

const MONEY_FORMAT = '#,##0.00';
const HOURS_FORMAT = '0.00';

const HEADERS = [
  'Employee code',
  'Name',
  'Schedule',
  'Device ID',
  'In payroll',
  'Exclusion reason',
  'Payable hours',
  'Overtime hours',
  'Days present',
  'Days absent',
  'Punctual days',
  'Merit days',
  'Base pay',
  'Punctuality pay',
  'Merit pay',
  'Holiday pay',
  'Extra / bonus',
  'Gross pay',
  'ESI',
  'PF',
  'Net pay',
  'Deductions',
  'Final pay',
  'Unresolved flags',
];

/** Column indices that hold money, and those that hold hours. */
const MONEY_COLUMNS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const HOURS_COLUMNS = [6, 7];

export function buildSummaryWorkbook(
  rows: SummaryRow[],
  period: { year: number; month: number; status: string },
): Uint8Array {
  const aoa: (string | number | boolean)[][] = [
    [`Payroll summary — ${periodLabel(period.year, period.month)}`],
    [`Status: ${period.status}`, `Generated: ${new Date().toLocaleString('en-IN')}`],
    [],
    HEADERS,
  ];

  for (const row of rows) {
    aoa.push([
      row.employeeCode,
      row.name,
      row.schedule,
      row.deviceId,
      row.inPayroll ? 'Yes' : 'No',
      row.exclusionReason,
      row.payableHours,
      row.overtimeHours,
      row.daysPresent,
      row.daysAbsent,
      row.daysPunctual,
      row.daysMerit,
      row.basePay,
      row.punctualityPay,
      row.meritPay,
      row.holidayPay,
      row.extraTotal,
      row.grossPay,
      row.esi,
      row.pf,
      row.netPay,
      row.deductionTotal,
      row.finalPay,
      row.unresolvedFlags,
    ]);
  }

  const included = rows.filter((row) => row.inPayroll);
  const sum = (pick: (row: SummaryRow) => number) => included.reduce((t, r) => t + pick(r), 0);

  aoa.push([]);
  aoa.push([
    '',
    `TOTAL (${included.length} in payroll)`,
    '',
    '',
    '',
    '',
    sum((r) => r.payableHours),
    sum((r) => r.overtimeHours),
    sum((r) => r.daysPresent),
    sum((r) => r.daysAbsent),
    sum((r) => r.daysPunctual),
    sum((r) => r.daysMerit),
    sum((r) => r.basePay),
    sum((r) => r.punctualityPay),
    sum((r) => r.meritPay),
    sum((r) => r.holidayPay),
    sum((r) => r.extraTotal),
    sum((r) => r.grossPay),
    sum((r) => r.esi),
    sum((r) => r.pf),
    sum((r) => r.netPay),
    sum((r) => r.deductionTotal),
    sum((r) => r.finalPay),
    sum((r) => r.unresolvedFlags),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  const headerRowIndex = 3; // zero-based
  const firstDataRow = headerRowIndex + 1;
  const lastRow = aoa.length - 1;

  for (let row = firstDataRow; row <= lastRow; row += 1) {
    for (const col of MONEY_COLUMNS) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (cell && typeof cell.v === 'number') cell.z = MONEY_FORMAT;
    }
    for (const col of HOURS_COLUMNS) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (cell && typeof cell.v === 'number') cell.z = HOURS_FORMAT;
    }
  }

  sheet['!cols'] = HEADERS.map((header, index) => ({
    wch: index === 1 ? 24 : Math.max(10, header.length + 2),
  }));
  sheet['!freeze'] = { xSplit: '2', ySplit: '4' };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Summary');

  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}
