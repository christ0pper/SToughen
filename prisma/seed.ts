/**
 * Bootstraps the one thing an empty install cannot create for itself: an account
 * to sign in with.
 *
 * It creates no employees and no attendance. Everyone on the payroll arrives
 * either from the Employees tab or from matching a block in the first biometric
 * export - there is no such thing as a sample employee, because a sample
 * employee that reaches production is a person nobody hired being paid.
 *
 * Safe to re-run: it upserts, and it never overwrites a password that already
 * exists. Change the credentials with:
 *
 *   ADMIN_EMAIL=you@company.local ADMIN_PASSWORD='...' npm run db:seed
 *
 * The username is whatever you put in ADMIN_EMAIL - the sign-in screen matches
 * it as a plain string, so it does not have to be an email address. It defaults
 * to 123/123 while the app is being built, which is a development convenience
 * and nothing else.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

/** What the in-app policy asks for. The bootstrap warns below it, not refuses. */
const RECOMMENDED_PASSWORD_LENGTH = 12;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? '123').trim().toLowerCase();
const ADMIN_NAME = process.env.ADMIN_NAME ?? 'Owner (Admin)';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '123';

async function main() {
  const existing = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });

  await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: 'ADMIN',
    },
    update: {},
  });

  const employees = await db.employee.count();
  const periods = await db.payrollPeriod.count();

  console.log(existing ? `Admin ${ADMIN_EMAIL} already exists - left as it is.` : `Created Admin ${ADMIN_EMAIL}.`);

  if (ADMIN_PASSWORD.length < RECOMMENDED_PASSWORD_LENGTH) {
    console.log(`\n  !  That password is ${ADMIN_PASSWORD.length} characters.`);
    console.log(`     Fine while you are building; set a real one before this holds`);
    console.log(`     anyone's pay, and before the machine is reachable on the network:`);
    console.log(`\n       ADMIN_EMAIL=you@company.local ADMIN_PASSWORD='...' npm run db:seed`);
  }

  console.log(`\nDatabase holds ${employees} employee(s) and ${periods} payroll period(s).`);
  if (employees === 0) {
    console.log('Add people on the Employees tab, or upload an export and match the blocks it finds.');
  }

  console.log('\nMore accounts are created in the app: Settings -> Accounts.');
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
