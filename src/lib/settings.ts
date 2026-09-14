import { ROUNDING } from '@/domain/config';
import type { GraceMinutes } from '@/domain/hours';
import { db } from './db';

export const SETTING_KEYS = {
  esiWageThreshold: 'esi_wage_threshold',
  companyName: 'company_name',
  lateArrivalGraceMinutes: 'late_arrival_grace_minutes',
  earlyDepartureGraceMinutes: 'early_departure_grace_minutes',
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/**
 * The Admin configures this explicitly. No statutory figure is assumed, so an
 * unset threshold means "no threshold check", never a hardcoded default.
 */
export async function getEsiWageThreshold(): Promise<number | null> {
  const raw = await getSetting(SETTING_KEYS.esiWageThreshold);
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseGraceMinutes(raw: string | null, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 120 ? value : fallback;
}

/**
 * Spec 12.3's rounding grace (docs/RULE-DECISIONS.md #1): the spec grants an
 * explicit 30-minute grace only on the two sides that add hours, then refers
 * to a grace on the two sides that reduce hours without ever defining one.
 * That is the product owner's call, not a code-level default, so it lives in
 * Settings and can be changed from the app without a redeploy.
 *
 * `ROUNDING.*` (env-configurable, defaults to 0/strict) is the fallback used
 * until the owner sets a value here for the first time.
 */
export async function getRoundingGrace(): Promise<GraceMinutes> {
  const [lateRaw, earlyRaw] = await Promise.all([
    getSetting(SETTING_KEYS.lateArrivalGraceMinutes),
    getSetting(SETTING_KEYS.earlyDepartureGraceMinutes),
  ]);
  return {
    lateArrival: parseGraceMinutes(lateRaw, ROUNDING.lateArrivalGraceMinutes),
    earlyDeparture: parseGraceMinutes(earlyRaw, ROUNDING.earlyDepartureGraceMinutes),
  };
}
