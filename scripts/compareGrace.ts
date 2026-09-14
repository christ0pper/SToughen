/**
 * Measures how many days each reading of spec 12.3 sends to the review queue.
 *
 * The spec grants an explicit 30-minute grace only on the sides that would add
 * hours, then refers to "early departure or late arrival beyond grace" without
 * ever defining one. This runs the sample export through both readings so the
 * choice can be made on numbers rather than on grammar.
 *
 * Usage: npm run compare-grace -- <path to export.xls>
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function inputPath(): string {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage: npm run compare-grace -- <path to export.xls>');
  const path = resolve(process.cwd(), arg);
  if (!existsSync(path)) throw new Error(`No such file: ${path}`);
  return path;
}

const SAMPLE = inputPath();

interface Measurement {
  total: number;
  flagged: number;
  byFlag: Record<string, number>;
}

function measure(lateGrace: number, earlyGrace: number): Measurement {
  // Spawn node directly: Node 24 refuses to spawnSync a .cmd shim like npx.cmd.
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', resolve(process.cwd(), 'scripts', 'graceProbe.ts')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SAMPLE_PATH: SAMPLE,
        PAYROLL_LATE_ARRIVAL_GRACE_MINUTES: String(lateGrace),
        PAYROLL_EARLY_DEPARTURE_GRACE_MINUTES: String(earlyGrace),
      },
    },
  );
  const line = output.trim().split('\n').pop() ?? '{}';
  return JSON.parse(line) as Measurement;
}

const strict = measure(0, 0);
const lenient = measure(30, 30);

const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(0)}%`;
const describe = (label: string, m: Measurement) => {
  console.log(`${label.padEnd(34)}${String(m.flagged).padStart(4)} of ${m.total} days flagged  (${pct(m.flagged, m.total)})`);
  for (const [flag, count] of Object.entries(m.byFlag).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${flag.padEnd(26)}${String(count).padStart(4)}`);
  }
};

console.log('Sample export, punch-based employees, Sundays excluded.\n');
describe('Strict reading (grace 0/0):', strict);
console.log('');
describe('Lenient reading (grace 30/30):', lenient);
console.log(
  `\nThe strict reading sends ${strict.flagged - lenient.flagged} more days to manual review.`,
);
console.log(
  'Set PAYROLL_LATE_ARRIVAL_GRACE_MINUTES and PAYROLL_EARLY_DEPARTURE_GRACE_MINUTES',
);
console.log('to 30 in .env to adopt the lenient reading.');
