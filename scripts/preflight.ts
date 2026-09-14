/**
 * Checks the things that are fine while you are building and dangerous the
 * moment this leaves your machine.
 *
 *   npm run preflight
 *
 * Run it before pushing to GitHub and before deploying to the office PC. It
 * exits non-zero if anything is unsafe, so it can gate a commit hook or CI.
 *
 * It reads .env, which is gitignored - so what it checks is the state of THIS
 * machine, not of the code. That is the point: the code is safe by default and
 * these are the local switches that make it unsafe.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix: string;
}

const PLACEHOLDER_SECRET = 'change-me-in-production-at-least-32-characters-long';
const OBVIOUS_PASSWORDS = ['123', '1234', 'password', 'admin', '123456'];

function readEnvFile(): Record<string, string> {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  const env = readEnvFile();
  const checks: Check[] = [];

  // --- 1. sign-in ----------------------------------------------------------
  const bypass = env.AUTH_DISABLED === 'true';
  checks.push({
    name: 'Sign-in is enabled',
    ok: !bypass,
    detail: bypass
      ? 'AUTH_DISABLED=true in .env - anyone who can reach the app is signed in as an Admin'
      : 'no AUTH_DISABLED in .env',
    fix: 'Delete the AUTH_DISABLED line from .env.',
  });

  // --- 2. session secret ---------------------------------------------------
  const secret = env.SESSION_SECRET ?? '';
  const secretOk = secret.length >= 32 && secret !== PLACEHOLDER_SECRET;
  checks.push({
    name: 'SESSION_SECRET is real',
    ok: secretOk,
    detail:
      secret === PLACEHOLDER_SECRET
        ? 'still the placeholder that ships in the repo - anyone with it can forge a session'
        : secret.length < 32
          ? `only ${secret.length} characters, needs 32`
          : 'set and long enough',
    fix: 'Put 32+ random characters in SESSION_SECRET. e.g. node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"',
  });

  // --- 3. passwords --------------------------------------------------------
  const users = await db.user.findMany({ select: { email: true, passwordHash: true, isActive: true } });
  const weak = users.filter(
    (user) => user.isActive && OBVIOUS_PASSWORDS.some((guess) => bcrypt.compareSync(guess, user.passwordHash)),
  );
  checks.push({
    name: 'No guessable passwords',
    ok: weak.length === 0,
    detail:
      weak.length === 0
        ? `${users.length} account(s) checked`
        : `${weak.map((user) => user.email).join(', ')} can be signed into by guessing`,
    fix: "Set a real one: ADMIN_EMAIL=you@company.local ADMIN_PASSWORD='...' npm run db:seed",
  });

  // --- 4. an admin exists --------------------------------------------------
  const admins = users.filter((user) => user.isActive).length;
  checks.push({
    name: 'At least one active account',
    ok: admins > 0,
    detail: `${admins} active`,
    fix: 'npm run db:seed',
  });

  // --- report --------------------------------------------------------------
  const width = Math.max(...checks.map((check) => check.name.length));
  console.log('');
  for (const check of checks) {
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(width)}  ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length === 0) {
    console.log('\nSafe to push and deploy.\n');
    return;
  }

  console.log(`\n${failed.length} thing(s) to fix first:\n`);
  for (const check of failed) console.log(`  ${check.name}\n    ${check.fix}\n`);
  process.exitCode = 1;
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
