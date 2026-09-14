/**
 * Counts flagged days for one rounding configuration and prints a JSON line.
 * Driven by scripts/compareGrace.ts, which runs it once per reading — the
 * grace values are read when the config module first loads, so each reading
 * needs its own process.
 */

import { readFileSync } from 'node:fs';
import { parseBiometricWorkbook } from '../src/import/parseBiometricXls';
import { computeDay } from '../src/domain/hours';
import { daysInMonth, makeDate } from '../src/domain/time';
import type { ScheduleCode, StatusCode } from '../src/domain/config';

const YEAR = Number(process.env.PROBE_YEAR ?? 2025);
const MONTH = Number(process.env.PROBE_MONTH ?? 7);

/** Matches the seeded master list. */
const SCHEDULES: Record<string, ScheduleCode> = {
  '2': 'PS',
  '17': 'NS',
  '31': 'OS',
  '77': 'PS',
};

const parsed = parseBiometricWorkbook(readFileSync(process.env.SAMPLE_PATH!));

let total = 0;
let flagged = 0;
const byFlag: Record<string, number> = {};

for (const block of parsed.employees) {
  const schedule = SCHEDULES[block.deviceId];
  if (!schedule) continue;

  const byDay = new Map(block.days.map((day) => [day.day, day]));
  const lastDay = daysInMonth(YEAR, MONTH);

  for (let day = 1; day <= lastDay; day += 1) {
    const date = makeDate(YEAR, MONTH, day);
    if (date.getDay() === 0) continue; // Sunday is the weekly off

    const source = byDay.get(day);
    total += 1;

    const result = computeDay(
      {
        date,
        status: (source?.status ?? 'UNKNOWN') as StatusCode,
        rawIn: source?.inMinutes ?? null,
        rawOut: source?.outMinutes ?? null,
      },
      schedule,
    );

    if (result.isFlagged) {
      flagged += 1;
      for (const flag of result.flags) byFlag[flag] = (byFlag[flag] ?? 0) + 1;
    }
  }
}

console.log(JSON.stringify({ total, flagged, byFlag }));
