/**
 * Clears every payroll record from the database, keeping only the sign-in
 * accounts.
 *
 * For emptying a machine that was used to try the app out, before real data
 * goes onto it. It deletes employees, attendance, payroll lines, imports and
 * the audit trail - everything that describes a person or a month.
 *
 * It refuses unless you mean it:
 *
 *   npm run reset -- --yes
 *
 * There is no undo. Copy prisma/payroll.db somewhere first.
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  if (!process.argv.includes('--yes')) {
    const [employees, days, lines, periods, audits] = await Promise.all([
      db.employee.count(),
      db.attendanceDay.count(),
      db.payrollLine.count(),
      db.payrollPeriod.count(),
      db.auditLog.count(),
    ]);

    console.log('This would permanently delete:');
    console.log(`  ${employees} employee(s)`);
    console.log(`  ${days} attendance day(s)`);
    console.log(`  ${lines} payroll line(s)`);
    console.log(`  ${periods} payroll period(s)`);
    console.log(`  ${audits} audit entr(ies)`);
    console.log('\nSign-in accounts and app settings are kept.');
    console.log('\nBack up prisma/payroll.db, then re-run with:  npm run reset -- --yes');
    return;
  }

  // Order matters: children before parents, so no foreign key is left dangling
  // even where the schema would have cascaded.
  await db.auditLog.deleteMany();
  await db.payrollLine.deleteMany();
  await db.attendanceDay.deleteMany();
  await db.unmatchedBlock.deleteMany();
  await db.zeroPunchReview.deleteMany();
  await db.importBatch.deleteMany();
  await db.extraBonus.deleteMany();
  await db.deduction.deleteMany();
  await db.employeeRate.deleteMany();
  await db.employee.deleteMany();
  await db.payrollPeriod.deleteMany();

  const users = await db.user.count();
  console.log('Payroll data cleared.');
  console.log(`${users} sign-in account(s) kept. Employees and periods are now empty.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
