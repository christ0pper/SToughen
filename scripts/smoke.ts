/**
 * End-to-end check: .xls -> parse -> import -> calculate -> print.
 *
 * Takes a real biometric export, because a synthetic one only ever proves that
 * the parser agrees with whoever wrote the generator:
 *
 *   npm run smoke -- "C:/path/to/WorkDurationReport july.xls" 2026 7
 *
 * It writes to whatever DATABASE_URL points at, so point it at a scratch copy
 * rather than live payroll:
 *
 *   DATABASE_URL="file:./scratch.db" npm run smoke -- "...\export.xls" 2026 7
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/lib/db';
import { parseBiometricWorkbook } from '../src/import/parseBiometricXls';
import { isoDate } from '../src/domain/time';
import { importParsedWorkbook } from '../src/services/importService';
import { calculatePeriod, checkReadiness, getFlaggedDays } from '../src/services/payrollService';

const [fileArg, yearArg, monthArg] = process.argv.slice(2);

function inputPath(): string {
  if (!fileArg) {
    throw new Error(
      'Usage: npm run smoke -- <path to export.xls> [year] [month]. ' +
        'Point it at a real biometric export.',
    );
  }
  const path = resolve(process.cwd(), fileArg);
  if (!existsSync(path)) throw new Error(`No such file: ${path}`);
  return path;
}

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const padNum = (value: number, width: number) => value.toFixed(2).padStart(width);

async function main() {
  const path = inputPath();
  console.log(`Reading ${path}`);


  const parsed = parseBiometricWorkbook(readFileSync(path));

  // The header's own month is the default, so the common case needs no extra
  // arguments - but it is only ever a suggestion, and an explicit one wins.
  const YEAR = yearArg ? Number(yearArg) : parsed.detectedPeriod?.year;
  const MONTH = monthArg ? Number(monthArg) : parsed.detectedPeriod?.month;
  if (!YEAR || !MONTH) {
    throw new Error('Could not read a period from the file header. Pass the year and month.');
  }
  console.log(`Period: ${MONTH}/${YEAR}${yearArg ? ' (from arguments)' : ' (from the file header)'}`);
  console.log(
    `Parsed ${parsed.employees.length} blocks across ${parsed.sheets.length} sheet(s); detected period ${
      parsed.detectedPeriod ? `${parsed.detectedPeriod.month}/${parsed.detectedPeriod.year}` : 'unknown'
    }`,
  );
  for (const warning of parsed.warnings) console.log(`  ! ${warning}`);

  const summary = await importParsedWorkbook({
    year: YEAR,
    month: MONTH,
    fileName: path.split(/[\\/]/).pop() ?? 'sample.xls',
    fileHash: `smoke-${Date.now()}`,
    userId: null,
    parsed,
  });

  console.log(
    `\nImported: ${summary.matched} matched, ${summary.unmatched} unmatched, ` +
      `${summary.daysCreated} day rows created, ${summary.daysUpdated} updated, ` +
      `${summary.zeroPunchEmployees} zero-punch employee(s)`,
  );
  for (const warning of summary.warnings) console.log(`  ! ${warning}`);

  const calculation = await calculatePeriod(summary.periodId, null);
  console.log(`\nCalculated ${calculation.linesWritten} employee(s).`);

  const lines = await db.payrollLine.findMany({
    where: { periodId: summary.periodId },
    include: { employee: true },
    orderBy: { employee: { name: 'asc' } },
  });

  console.log('\n' + pad('Employee', 20) + pad('Sch', 6) + '   Hours     Gross       ESI        PF     Final  Flags');
  console.log('-'.repeat(88));

  for (const line of lines) {
    if (!line.inPayroll) continue;
    console.log(
      pad(line.employee.name, 20) +
        pad(line.employee.scheduleType, 6) +
        padNum(line.payableHours, 8) +
        padNum(line.grossPay, 10) +
        padNum(line.esi, 10) +
        padNum(line.pf, 10) +
        padNum(line.finalPay, 10) +
        String(line.daysUnresolved).padStart(7),
    );
  }

  const excluded = lines.filter((line) => !line.inPayroll);
  if (excluded.length > 0) {
    console.log('\nNot in this payroll:');
    for (const line of excluded) console.log(`  ${line.employee.name} — ${line.exclusionReason}`);
  }

  const flagged = await getFlaggedDays(summary.periodId);
  console.log(`\nFlagged days awaiting review: ${flagged.length}`);
  for (const row of flagged.slice(0, 8)) {
    console.log(
      `  ${isoDate(row.computation.date)}  ${pad(row.employeeName, 18)}` +
        `${row.computation.flags.join(', ')}`,
    );
  }
  if (flagged.length > 8) console.log(`  … and ${flagged.length - 8} more`);

  const readiness = await checkReadiness(summary.periodId);
  console.log(`\nReady to lock: ${readiness.ready}`);
  for (const blocker of readiness.blockers) console.log(`  - ${blocker}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
