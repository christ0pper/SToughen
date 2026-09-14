/**
 * Points the app at a different database, without touching any application code.
 *
 *   npm run db:use -- supabase     # cloud Postgres, while validating
 *   npm run db:use -- local        # the SQLite file on this machine
 *
 * The schema has no provider-specific types, so the only difference between the
 * two is the `provider` line in schema.prisma and the connection string. This
 * rewrites both, regenerates the Prisma client for the provider now in use, and
 * creates the tables if the target is empty.
 *
 * It never copies data and never deletes it. Moving records between the two is
 * `npm run db:copy`, run deliberately after this.
 *
 * Connection strings are read from .env, which is gitignored:
 *
 *   LOCAL_DATABASE_URL="file:./payroll.db"
 *   SUPABASE_DATABASE_URL="postgres://prisma.<ref>:<password>@<region>.pooler.supabase.com:5432/postgres"
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Target = 'supabase' | 'local';

const SCHEMA = resolve(process.cwd(), 'prisma/schema.prisma');
const ENV = resolve(process.cwd(), '.env');

const PROVIDER: Record<Target, string> = { supabase: 'postgresql', local: 'sqlite' };
const URL_KEY: Record<Target, string> = {
  supabase: 'SUPABASE_DATABASE_URL',
  local: 'LOCAL_DATABASE_URL',
};

function readEnv(): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(ENV)) return values;
  for (const line of readFileSync(ENV, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
  }
  return values;
}

/** Sets one key in .env, keeping every other line exactly as it was. */
function writeEnvValue(key: string, value: string): void {
  const lines = existsSync(ENV) ? readFileSync(ENV, 'utf8').split('\n') : [];
  const entry = `${key}="${value}"`;
  const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (index >= 0) lines[index] = entry;
  else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, entry);
  writeFileSync(ENV, lines.join('\n').replace(/\n*$/, '\n'));
}

/** A password in a connection string must never reach the terminal. */
function mask(url: string): string {
  return url.replace(/(\/\/[^:/]+:)[^@]+@/, '$1****@');
}

/**
 * Supabase's transaction pooler (port 6543) cannot create tables - it hands each
 * statement to whichever connection is free, and schema changes need one. The
 * session pooler on the same host does, on 5432. The app itself runs happily on
 * either for a single long-lived server, so the session URL is used for both.
 */
function sessionUrl(url: string): string {
  if (!url.includes('pooler.supabase.com:6543')) return url;
  return url
    .replace('pooler.supabase.com:6543', 'pooler.supabase.com:5432')
    .replace(/[?&]pgbouncer=true/, '')
    .replace(/\?$/, '');
}

/**
 * Opens one connection and runs `select 1`. Returns 'ok', or a sentence a person
 * can act on.
 *
 * Supabase blocks an address for a while after repeated failed logins, so this is
 * called once per run and never retried in a loop.
 */
function probeConnection(url: string): string {
  const prismaCli = resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  // A long hop - Tokyo from India answers in seconds, and Prisma's default
  // 5-second timeout turns a slow login into a misleading "can't reach server".
  const withTimeout = url + (url.includes('?') ? '&' : '?') + 'connect_timeout=30';
  try {
    execFileSync(process.execPath, [prismaCli, 'db', 'execute', '--url', withTimeout, '--stdin'], {
      input: 'select 1;',
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return 'ok';
  } catch (error) {
    const text = String((error as { stderr?: string }).stderr ?? error);
    if (/Authentication failed|password authentication|credentials .* are not valid/i.test(text)) {
      return 'The database password was rejected. It is the password set on the project for the ' +
        'database, not the one you sign in to supabase.com with. Reset it in Project Settings -> ' +
        'Database if unsure. Supabase blocks an address after several failed logins, so fix it ' +
        'before trying again.';
    }
    if (/Tenant or user not found/i.test(text)) {
      return 'The pooler does not recognise this project. Copy the connection string again from ' +
        'Connect -> ORMs -> Prisma - the host must match the project.';
    }
    if (/Can't reach|P1001|timed out|ETIMEDOUT|ECONNREFUSED/i.test(text)) {
      return 'The server did not answer. Check the host and port, and that this network allows ' +
        'outbound connections on 5432.';
    }
    return text.replace(/postgres(ql)?:\/\/[^@\s]+@/g, 'postgres://****@').trim().split(/\r?\n/).slice(-3).join(' ');
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  // Node 24 will not spawn a .cmd shim directly, so go through node itself.
  const prismaCli = resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const [bin, ...rest] = command === 'prisma' ? [process.execPath, prismaCli, ...args] : [command, ...args];
  execFileSync(bin, rest, { stdio: 'inherit', env });
}

function main(): void {
  const target = process.argv[2] as Target | undefined;
  if (target !== 'supabase' && target !== 'local') {
    console.error('Usage: npm run db:use -- supabase | local');
    process.exit(1);
  }

  const env = readEnv();

  // First run: remember the SQLite file before anything else is pointed elsewhere.
  if (!env.has('LOCAL_DATABASE_URL')) {
    const current = env.get('DATABASE_URL') ?? 'file:./payroll.db';
    writeEnvValue('LOCAL_DATABASE_URL', current.startsWith('file:') ? current : 'file:./payroll.db');
    env.set('LOCAL_DATABASE_URL', current.startsWith('file:') ? current : 'file:./payroll.db');
  }

  let url = env.get(URL_KEY[target]);
  if (!url) {
    console.error(`\n  ${URL_KEY[target]} is not set in .env.\n`);
    if (target === 'supabase') {
      console.error('  In Supabase: Connect (top of the project) -> ORMs -> Prisma.');
      console.error('  Copy the connection string into .env yourself - it holds the database');
      console.error('  password, so it should not go anywhere it could be logged:\n');
      console.error('    SUPABASE_DATABASE_URL="postgres://..."\n');
    }
    process.exit(1);
  }
  if (target === 'supabase') url = sessionUrl(url);

  // --- can we actually get in? -----------------------------------------------
  // Checked before a single file is touched. The first version rewrote the
  // schema and .env and only then found the password was wrong, leaving the app
  // pointed at a database it could not open. `db execute --url` goes through
  // Prisma's schema engine, which reads the provider from the URL itself, so it
  // works even while the generated client is still for the other database.
  if (target === 'supabase') {
    console.log(`
  Checking ${mask(url)} ...`);
    const probe = probeConnection(url);
    if (probe !== 'ok') {
      console.error(`
  Could not open the Supabase database - nothing has been changed.
`);
      console.error(`  ${probe}
`);
      process.exit(1);
    }
    console.log('  Connected.');
  }

  // --- provider line ---------------------------------------------------------
  const schema = readFileSync(SCHEMA, 'utf8');
  const updated = schema.replace(
    /(datasource db \{[^}]*provider\s*=\s*)"[a-z]+"/,
    `$1"${PROVIDER[target]}"`,
  );
  if (updated === schema && !schema.includes(`provider = "${PROVIDER[target]}"`)) {
    console.error('Could not find the provider line in prisma/schema.prisma.');
    process.exit(1);
  }
  writeFileSync(SCHEMA, updated);

  // --- active connection -----------------------------------------------------
  writeEnvValue('DATABASE_URL', url);

  console.log(`\n  Database: ${target}   (${PROVIDER[target]})`);
  console.log(`  ${mask(url)}\n`);

  const childEnv = { ...process.env, DATABASE_URL: url };

  // --- client and tables -----------------------------------------------------
  run('prisma', ['generate'], childEnv);
  // db push creates whatever tables are missing and refuses anything that would
  // lose data - it is safe against a database that already holds records.
  run('prisma', ['db', 'push', '--skip-generate'], childEnv);

  console.log(`\n  Switched to ${target}. Restart the app for it to take effect.`);
  if (target === 'supabase') {
    console.log('  Next: npm run db:secure   (locks the tables against the public API)');
  }
  console.log('');
}

main();
