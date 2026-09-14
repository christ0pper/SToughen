/**
 * Server-side payslip PDFs.
 *
 * pdfmake ships Roboto only as base64 inside vfs_fonts.js, so the bytes are
 * decoded once and handed to PdfPrinter as in-memory buffers - no font files on
 * disk, and nothing to install at deploy time.
 *
 * Amounts are prefixed "Rs." rather than the rupee sign: the bundled Roboto is
 * not guaranteed to carry U+20B9, and a silently missing glyph on a payslip is
 * worse than plain ASCII. The screens and the Excel export use the symbol.
 */

import { createRequire } from 'node:module';
import type { PayslipData, PayslipLine } from '@/services/reportService';
import { money, periodLabel, shortDate } from './format';

const require = createRequire(import.meta.url);

type FontBuffers = Record<string, Buffer>;

let cachedFonts: FontBuffers | null = null;

function loadFonts(): FontBuffers {
  if (cachedFonts) return cachedFonts;

  const module = require('pdfmake/build/vfs_fonts.js');
  const vfs: Record<string, string> = module.pdfMake?.vfs ?? module.vfs ?? module;

  const decode = (name: string): Buffer => {
    const base64 = vfs[name];
    if (!base64) throw new Error(`pdfmake is missing the bundled font ${name}.`);
    return Buffer.from(base64, 'base64');
  };

  cachedFonts = {
    normal: decode('Roboto-Regular.ttf'),
    bold: decode('Roboto-Medium.ttf'),
    italics: decode('Roboto-Italic.ttf'),
    bolditalics: decode('Roboto-MediumItalic.ttf'),
  };
  return cachedFonts;
}

const rs = (amount: number) => `Rs. ${money(amount)}`;

function lineRows(lines: PayslipLine[]): unknown[][] {
  if (lines.length === 0) return [[{ text: '—', colSpan: 2, color: '#94a3b8' }, {}]];
  return lines.map((line) => [line.label, { text: rs(line.amount), alignment: 'right' }]);
}

function payslipContent(data: PayslipData): unknown[] {
  const { employee } = data;

  const totalOf = (lines: PayslipLine[]) => lines.reduce((sum, line) => sum + line.amount, 0);

  return [
    { text: 'PAYSLIP', style: 'title' },
    {
      text: `${periodLabel(data.period.year, data.period.month)}${
        data.period.status === 'LOCKED' ? '' : '  (DRAFT — not yet approved)'
      }`,
      style: 'subtitle',
    },

    {
      style: 'meta',
      columns: [
        {
          width: '*',
          stack: [
            { text: employee.name, bold: true, fontSize: 12 },
            `${employee.employeeCode}${employee.deviceId ? `  ·  device ${employee.deviceId}` : ''}`,
            employee.position ?? '',
            `Schedule: ${
              employee.scheduleType === 'EXCEPTION'
                ? `Exception role (${employee.exceptionRole ?? '—'})`
                : employee.scheduleType
            }`,
            `Joined: ${shortDate(employee.joiningDate)}`,
          ].filter(Boolean),
        },
        {
          width: 'auto',
          stack: [
            `${data.salaried ? 'Monthly salary' : 'Hourly rate'}: ${data.payLabel.replace(/\u20b9/g, 'Rs. ')}`,
            data.salaried ? '' : `Payable hours: ${data.hours.payable.toFixed(2)}`,
            data.hours.overtime > 0 ? `Overtime hours: ${data.hours.overtime.toFixed(2)}` : '',
            data.hours.paidLeave > 0 ? `Paid leave hours: ${data.hours.paidLeave.toFixed(2)}` : '',
            `Days present: ${data.days.present}   Absent: ${data.days.absent}`,
            `Punctual days: ${data.days.punctual}   Merit days: ${data.days.merit}`,
          ].filter(Boolean),
        },
      ],
    },

    { text: 'Earnings', style: 'section' },
    {
      table: {
        widths: ['*', 90],
        body: [
          ...lineRows(data.earnings),
          [
            { text: 'Gross pay', bold: true },
            { text: rs(data.grossPay), alignment: 'right', bold: true },
          ],
        ],
      },
      layout: 'lightHorizontalLines',
    },

    { text: 'Statutory deductions', style: 'section' },
    {
      table: {
        widths: ['*', 90],
        body: [
          ...lineRows(data.statutory),
          [
            { text: 'Net pay', bold: true },
            { text: rs(data.netPay), alignment: 'right', bold: true },
          ],
        ],
      },
      layout: 'lightHorizontalLines',
    },

    { text: 'Other deductions', style: 'section' },
    {
      table: {
        widths: ['*', 90],
        body: [
          ...lineRows(data.deductions),
          [
            { text: 'Total deductions', bold: true },
            { text: rs(totalOf(data.deductions)), alignment: 'right', bold: true },
          ],
        ],
      },
      layout: 'lightHorizontalLines',
    },

    {
      style: 'total',
      table: {
        widths: ['*', 110],
        body: [
          [
            { text: 'FINAL PAYABLE', bold: true, fontSize: 12 },
            { text: rs(data.finalPay), alignment: 'right', bold: true, fontSize: 12 },
          ],
        ],
      },
      layout: 'noBorders',
    },

    employee.bankAccountNumber
      ? {
          style: 'small',
          text: `Bank: ${employee.bankName ?? '—'}  ·  A/c ${employee.bankAccountNumber}`,
        }
      : { text: '' },

    data.days.unresolved > 0
      ? {
          style: 'warning',
          text: `${data.days.unresolved} flagged day(s) were unresolved when this payslip was generated.`,
        }
      : { text: '' },

    {
      style: 'small',
      text: 'Computer-generated statement. Hours are calculated from biometric punch records against the assigned shift, less unpaid breaks.',
    },
  ];
}

const STYLES = {
  title: { fontSize: 16, bold: true, margin: [0, 0, 0, 2] as [number, number, number, number] },
  subtitle: { fontSize: 10, color: '#475569', margin: [0, 0, 0, 12] as [number, number, number, number] },
  meta: { fontSize: 9, margin: [0, 0, 0, 12] as [number, number, number, number] },
  section: { fontSize: 10, bold: true, margin: [0, 10, 0, 4] as [number, number, number, number] },
  total: { margin: [0, 12, 0, 8] as [number, number, number, number] },
  small: { fontSize: 8, color: '#64748b', margin: [0, 8, 0, 0] as [number, number, number, number] },
  warning: { fontSize: 8, color: '#b45309', margin: [0, 6, 0, 0] as [number, number, number, number] },
};

/** One PDF holding a page per payslip. */
export async function buildPayslipPdf(payslips: PayslipData[]): Promise<Buffer> {
  if (payslips.length === 0) throw new Error('There is nothing to generate a payslip from.');

  const PdfPrinter = require('pdfmake/src/printer.js');
  const fonts = loadFonts();
  const printer = new PdfPrinter({ Roboto: fonts });

  const content: unknown[] = [];
  payslips.forEach((payslip, index) => {
    if (index > 0) content.push({ text: '', pageBreak: 'before' });
    content.push(...payslipContent(payslip));
  });

  const document = printer.createPdfKitDocument({
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    styles: STYLES,
    content,
  });

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}
