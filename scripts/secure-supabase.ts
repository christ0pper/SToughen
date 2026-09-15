/**
 * Locks every payroll table against Supabase's public Data API.
 *
 *   npm run db:secure
 *
 * Supabase publishes the `public` schema over a REST API, reachable with the
 * project's publishable key - a key that is designed to be public and can be
 * found by anyone who knows the project address. This app never uses that API:
 * it reads and writes only through Prisma, on the server. So nothing about the
 * API should be able to reach payroll, and this makes sure of it twice over:
 *
 *   1. Row Level Security on, with no policies. The API's roles (`anon` and
 *      `authenticated`) then see zero rows. The connection Prisma uses owns the
 *      tables, and an owner is not subject to RLS, so the app is unaffected.
 *   2. Those two roles lose their privileges on the tables entirely, and on any
 *      table created later - so a forgotten RLS setting on a future table does
 *      not quietly reopen the door.
 *
 * Safe to re-run. Turning the Data API off in the dashboard (Project Settings ->
 * Data API) closes the same door a third time and is still worth doing.
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('postgres')) {
    console.error('DATABASE_URL is not a Postgres connection string. See .env.example.');
    process.exit(1);
  }

  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );

  if (tables.length === 0) {
    console.error('No tables in the public schema. Run `npx prisma db push` first.');
    process.exit(1);
  }

  for (const { tablename } of tables) {
    const quoted = `"public"."${tablename.replace(/"/g, '""')}"`;
    await db.$executeRawUnsafe(`alter table ${quoted} enable row level security`);
    await db.$executeRawUnsafe(`revoke all on table ${quoted} from anon, authenticated`);
  }

  // Tables Prisma creates in future inherit nothing either.
  await db.$executeRawUnsafe(
    `alter default privileges in schema public revoke all on tables from anon, authenticated`,
  );

  // Report what is true now, read back from the database, not what was intended.
  const state = await db.$queryRawUnsafe<{ tablename: string; rls: boolean; api_can_read: boolean }[]>(`
    select c.relname as tablename,
           c.relrowsecurity as rls,
           has_table_privilege('anon', c.oid, 'select') as api_can_read
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`);

  const open = state.filter((row) => !row.rls || row.api_can_read);
  console.log('');
  for (const row of state) {
    const ok = row.rls && !row.api_can_read;
    console.log(`  ${ok ? 'locked' : 'OPEN  '}  ${row.tablename}`);
  }
  console.log(
    open.length === 0
      ? `\n  All ${state.length} tables: RLS on, no access for the public API roles.\n`
      : `\n  ${open.length} table(s) still reachable. Do not put real data in until this is fixed.\n`,
  );
  if (open.length > 0) process.exitCode = 1;
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
