/**
 * Copies every record from the local SQLite file into whatever DATABASE_URL
 * currently points at.
 *
 *   npm run db:use -- supabase
 *   npm run db:copy
 *
 * Reads the source with Node's built-in SQLite driver rather than Prisma, because
 * only one Prisma client can be generated at a time and it is generated for the
 * destination. The destination write goes through Prisma, so every value is
 * checked against the schema on the way in.
 *
 * Refuses to write into a destination that already holds payroll data: merging
 * two copies of a ledger is not something to do by accident. Copy into an empty
 * database, or clear the destination first.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function localSqlitePath(): string {
  const envPath = resolve(process.cwd(), '.env');
  let url = 'file:./payroll.db';
  if (existsSync(envPath)) {
    const match = /^\s*LOCAL_DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(envPath, 'utf8'));
    if (match) url = match[1];
  }
  // Prisma resolves a relative SQLite path against the schema's folder.
  return resolve(process.cwd(), 'prisma', url.replace(/^file:/, ''));
}

/** Parents before children, derived from the schema so no foreign key fails. */
function insertionOrder(): Prisma.DMMF.Model[] {
  const models = Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((model) => [model.name, model]));
  const ordered: Prisma.DMMF.Model[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (model: Prisma.DMMF.Model) => {
    if (state.get(model.name) === 'done') return;
    if (state.get(model.name) === 'visiting') return; // a cycle; its FKs are nullable
    state.set(model.name, 'visiting');
    for (const field of model.fields) {
      if (field.kind === 'object' && field.relationFromFields?.length && field.type !== model.name) {
        const parent = byName.get(field.type);
        if (parent) visit(parent);
      }
    }
    state.set(model.name, 'done');
    ordered.push(model);
  };

  models.forEach(visit);
  return ordered;
}

/** SQLite stores DateTime as epoch milliseconds and Boolean as 0/1. */
function convert(model: Prisma.DMMF.Model, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of model.fields) {
    if (field.kind === 'object') continue;
    const value = row[field.dbName ?? field.name];
    if (value === null || value === undefined) {
      out[field.name] = null;
    } else if (field.type === 'DateTime') {
      out[field.name] = new Date(typeof value === 'number' ? value : String(value));
    } else if (field.type === 'Boolean') {
      out[field.name] = value === 1 || value === true || value === '1';
    } else if (field.type === 'Int') {
      out[field.name] = Number(value);
    } else if (field.type === 'Float') {
      out[field.name] = Number(value);
    } else {
      out[field.name] = value;
    }
  }
  return out;
}

const delegate = (model: Prisma.DMMF.Model) =>
  (db as unknown as Record<string, { count(): Promise<number>; createMany(args: { data: unknown[] }): Promise<{ count: number }> }>)[
    model.name.charAt(0).toLowerCase() + model.name.slice(1)
  ];

async function main() {
  const destination = process.env.DATABASE_URL ?? '';
  if (destination.startsWith('file:')) {
    console.error('DATABASE_URL points at the local SQLite file already - there is nowhere to copy to.');
    console.error('Run `npm run db:use -- supabase` first.');
    process.exit(1);
  }

  const sourcePath = localSqlitePath();
  if (!existsSync(sourcePath)) {
    console.error(`No SQLite file at ${sourcePath}.`);
    process.exit(1);
  }
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const order = insertionOrder();

  // --- refuse to merge -------------------------------------------------------
  // Accounts and settings are allowed to exist (a seed may have made them);
  // anything that is actual payroll data is not.
  const guarded = ['Employee', 'PayrollPeriod', 'AttendanceDay', 'PayrollLine'];
  for (const name of guarded) {
    const model = order.find((m) => m.name === name);
    if (model && (await delegate(model).count()) > 0) {
      console.error(`\nThe destination already has ${name} records. Refusing to merge two ledgers.`);
      console.error('Copy into an empty database instead.\n');
      process.exit(1);
    }
  }

  console.log(`\n  from  ${sourcePath}`);
  console.log(`  to    ${destination.replace(/(\/\/[^:/]+:)[^@]+@/, '$1****@')}\n`);

  let total = 0;
  for (const model of order) {
    const table = model.dbName ?? model.name;
    const rows = source.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
    if (rows.length === 0) continue;

    const data = rows.map((row) => convert(model, row));
    const existing = await delegate(model).count();

    // Accounts and settings already present (from a seed) are kept, not duplicated.
    const result = existing > 0
      ? await (db as unknown as Record<string, { createMany(args: { data: unknown[]; skipDuplicates: boolean }): Promise<{ count: number }> }>)[
          model.name.charAt(0).toLowerCase() + model.name.slice(1)
        ].createMany({ data, skipDuplicates: true })
      : await delegate(model).createMany({ data });

    total += result.count;
    console.log(`  ${String(result.count).padStart(6)}  ${model.name}${result.count < rows.length ? `  (${rows.length - result.count} already there)` : ''}`);
  }

  // --- prove it ---------------------------------------------------------------
  console.log('');
  let mismatches = 0;
  for (const model of order) {
    const table = model.dbName ?? model.name;
    const sourceCount = (source.prepare(`select count(*) as c from "${table}"`).get() as { c: number }).c;
    if (sourceCount === 0) continue;
    const destinationCount = await delegate(model).count();
    if (destinationCount < sourceCount) {
      mismatches += 1;
      console.log(`  MISMATCH  ${model.name}: ${sourceCount} locally, ${destinationCount} in the destination`);
    }
  }

  console.log(
    mismatches === 0
      ? `  Copied ${total} record(s). Every table in the destination holds at least what the local file does.\n`
      : `\n  ${mismatches} table(s) short. Do not rely on the destination until that is explained.\n`,
  );
  if (mismatches > 0) process.exitCode = 1;
  source.close();
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
