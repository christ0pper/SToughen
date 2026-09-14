'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { fail, ok, type ActionState } from '@/lib/actionResult';
import { recordAudit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { SETTING_KEYS, getSetting, setSetting } from '@/lib/settings';
import { isoDate } from '@/domain/time';

/**
 * Spec 12.3's rounding grace on the two sides that reduce hours - the single
 * most consequential open question in the build (docs/RULE-DECISIONS.md #1).
 * It is the owner's policy call, so it is set here rather than in code: 0
 * surfaces every minute of lateness for review, 30 absorbs small ones.
 */
export async function setRoundingGraceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireAdmin();

    const parse = (raw: string): number | null => {
      const trimmed = raw.trim();
      if (trimmed === '') return 0;
      const value = Number(trimmed);
      return Number.isFinite(value) && value >= 0 && value <= 120 ? Math.round(value) : null;
    };

    const lateArrival = parse(String(formData.get('lateArrivalGrace') ?? ''));
    const earlyDeparture = parse(String(formData.get('earlyDepartureGrace') ?? ''));

    if (lateArrival == null || earlyDeparture == null) {
      return { error: 'Enter a whole number of minutes between 0 and 120 for each.' };
    }

    const [beforeLate, beforeEarly] = await Promise.all([
      getSetting(SETTING_KEYS.lateArrivalGraceMinutes),
      getSetting(SETTING_KEYS.earlyDepartureGraceMinutes),
    ]);

    await Promise.all([
      setSetting(SETTING_KEYS.lateArrivalGraceMinutes, String(lateArrival)),
      setSetting(SETTING_KEYS.earlyDepartureGraceMinutes, String(earlyDeparture)),
    ]);

    await recordAudit({
      userId: user.id,
      action: 'SETTING_CHANGE',
      entityType: 'Setting',
      entityId: 'rounding_grace',
      field: 'roundingGrace',
      oldValue: `late ${beforeLate ?? 'unset'} / early ${beforeEarly ?? 'unset'}`,
      newValue: `late ${lateArrival} / early ${earlyDeparture}`,
      note: 'Changes how many days are flagged for review',
    });

    revalidatePath('/settings');
    return ok(
      `Saved. Recalculate a draft period to apply it — locked periods keep their approved figures until reopened.`,
    );
  } catch (error) {
    return fail(error);
  }
}

/**
 * The ESI wage threshold is never defaulted to a statutory figure - the Admin
 * types the number they want the warning to fire on, or clears it entirely.
 */
export async function setEsiThresholdAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireAdmin();
    const raw = String(formData.get('threshold') ?? '').trim();

    if (raw !== '') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a positive amount, or clear the field.' };
    }

    const before = await getSetting(SETTING_KEYS.esiWageThreshold);
    await setSetting(SETTING_KEYS.esiWageThreshold, raw);

    await recordAudit({
      userId: user.id,
      action: 'SETTING_CHANGE',
      entityType: 'Setting',
      entityId: SETTING_KEYS.esiWageThreshold,
      field: 'esiWageThreshold',
      oldValue: before,
      newValue: raw === '' ? null : raw,
    });

    revalidatePath('/settings');
    return ok(raw === '' ? 'Threshold cleared. No ESI threshold check will run.' : 'Threshold saved.');
  } catch (error) {
    return fail(error);
  }
}

export async function addHolidayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireAdmin();
    const dateRaw = String(formData.get('date') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();

    if (!dateRaw) return { error: 'Choose the date.' };
    if (!name) return { error: 'Name the holiday.' };

    const [year, month, day] = dateRaw.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    const existing = await db.holiday.findUnique({ where: { date } });
    if (existing) return { error: `${dateRaw} is already declared as "${existing.name}".` };

    const holiday = await db.holiday.create({ data: { date, name } });

    await recordAudit({
      userId: user.id,
      action: 'HOLIDAY_CHANGE',
      entityType: 'Holiday',
      entityId: holiday.id,
      newValue: `${dateRaw} — ${name}`,
    });

    revalidatePath('/settings');
    return ok(`${name} declared. Recalculate any affected period to apply it.`);
  } catch (error) {
    return fail(error);
  }
}

export async function removeHolidayAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireAdmin();
    const holidayId = String(formData.get('holidayId'));
    const holiday = await db.holiday.findUniqueOrThrow({ where: { id: holidayId } });

    await db.holiday.delete({ where: { id: holidayId } });

    await recordAudit({
      userId: user.id,
      action: 'HOLIDAY_CHANGE',
      entityType: 'Holiday',
      entityId: holidayId,
      oldValue: `${isoDate(holiday.date)} — ${holiday.name}`,
      newValue: null,
      note: 'Holiday removed',
    });

    revalidatePath('/settings');
    return ok('Holiday removed. Recalculate any affected period to apply it.');
  } catch (error) {
    return fail(error);
  }
}
