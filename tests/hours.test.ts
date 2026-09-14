import { describe, expect, it } from 'vitest';
import { computeDay, normalisePunchPair, roundPunchIn, roundPunchOut } from '@/domain/hours';
import { makeDate } from '@/domain/time';
import { EMPTY_RESOLUTION, type DayInput, type DayResolution } from '@/domain/types';
import type { ScheduleCode } from '@/domain/config';

// July 2025: 1st = Tuesday, 5th = Saturday, 6th = Sunday.
const TUESDAY = makeDate(2025, 7, 1);
const SATURDAY = makeDate(2025, 7, 5);
const SUNDAY = makeDate(2025, 7, 6);

const at = (h: number, m = 0) => h * 60 + m;

function day(overrides: Partial<DayInput> = {}): DayInput {
  return { date: TUESDAY, status: 'P', rawIn: null, rawOut: null, ...overrides };
}

function resolution(overrides: Partial<DayResolution> = {}): DayResolution {
  return { ...EMPTY_RESOLUTION, ...overrides };
}

function run(schedule: ScheduleCode, input: Partial<DayInput>, res?: DayResolution) {
  return computeDay(day(input), schedule, res);
}

describe('sanity: a clean shift is exactly 8 payable hours', () => {
  it('OS 09:00-18:00 minus three breaks = 480 minutes', () => {
    const result = run('OS', { rawIn: at(9), rawOut: at(18) });
    expect(result.spanMinutes).toBe(540);
    expect(result.breakMinutes).toBe(60);
    expect(result.calculatedWorkedMinutes).toBe(480);
    expect(result.flags).toEqual([]);
    expect(result.punctualityAwarded).toBe(true);
  });

  it('PS 08:00-17:00 minus three breaks = 480 minutes', () => {
    const result = run('PS', { rawIn: at(8), rawOut: at(17) });
    expect(result.breakMinutes).toBe(60);
    expect(result.calculatedWorkedMinutes).toBe(480);
    expect(result.flags).toEqual([]);
  });

  it('NS 22:00-06:00 crosses midnight and takes no break deduction', () => {
    const result = run('NS', { rawIn: at(22), rawOut: at(6) });
    expect(result.breakDeductions).toEqual([]);
    expect(result.spanMinutes).toBe(480);
    expect(result.calculatedWorkedMinutes).toBe(480);
    expect(result.flags).toEqual([]);
    expect(result.punctualityAwarded).toBe(true);
  });
});

describe('rounding (spec 12.3)', () => {
  it('never credits early arrival, at any distance', () => {
    expect(roundPunchIn(at(8, 45), 'OS')).toBe(at(9));
    expect(roundPunchIn(at(7), 'OS')).toBe(at(9));
    expect(run('OS', { rawIn: at(7), rawOut: at(18) }).calculatedWorkedMinutes).toBe(480);
  });

  it('caps late departure at shift end regardless of how late', () => {
    expect(roundPunchOut(at(18, 20), 'OS')).toBe(at(18));
    expect(roundPunchOut(at(22), 'OS')).toBe(at(18));
    expect(run('OS', { rawIn: at(9), rawOut: at(21) }).calculatedWorkedMinutes).toBe(480);
  });

  it('uses actual time for late arrival, reducing payable hours', () => {
    const result = run('OS', { rawIn: at(9, 20), rawOut: at(18) });
    expect(result.effectiveInMinutes).toBe(at(9, 20));
    expect(result.calculatedWorkedMinutes).toBe(460);
    expect(result.flags).toContain('NOT_STANDARD_DAY');
    expect(result.punctualIn).toBe(false);
    expect(result.punctualityAwarded).toBe(false);
  });

  it('uses actual time for early departure', () => {
    const result = run('OS', { rawIn: at(9), rawOut: at(17) });
    expect(result.effectiveOutMinutes).toBe(at(17));
    // 480 span - all three breaks (17:00 still clears the 16:15-16:30 tea slot)
    expect(result.breakMinutes).toBe(60);
    expect(result.calculatedWorkedMinutes).toBe(420);
    expect(result.punctualOut).toBe(false);
  });
});

describe('unpaid breaks (spec 12.2)', () => {
  it('does not deduct a break the employee was not there for', () => {
    // OS leaving at 13:00 - the 13:00-13:30 lunch slot never starts within the span.
    const result = run('OS', { rawIn: at(9), rawOut: at(13) });
    const keys = result.breakDeductions.map((b) => b.key);
    expect(keys).toEqual(['BREAKFAST']);
    expect(result.breakMinutes).toBe(15);
    expect(result.calculatedWorkedMinutes).toBe(225);
  });

  it('deducts only the overlapping part of a partially covered break', () => {
    // OS leaving 13:10 covers 10 of the 30 lunch minutes.
    const result = run('OS', { rawIn: at(9), rawOut: at(13, 10) });
    const lunch = result.breakDeductions.find((b) => b.key === 'LUNCH');
    expect(lunch?.minutes).toBe(10);
  });

  it('PS takes breaks in the first half of each window, OS in the second', () => {
    // 09:00-09:15 is a PS breakfast slot but not an OS one.
    const ps = run('PS', { rawIn: at(8), rawOut: at(9, 15) });
    expect(ps.breakDeductions.map((b) => b.key)).toEqual(['BREAKFAST']);

    const os = run('OS', { rawIn: at(9), rawOut: at(9, 30) });
    expect(os.breakDeductions).toEqual([]);
  });
});

describe('night shift normalisation', () => {
  it('rolls the punch-out into the next day', () => {
    expect(normalisePunchPair(at(22), at(6), 'NS')).toEqual({
      inMinutes: at(22),
      outMinutes: at(30),
    });
  });

  it('treats an after-midnight punch-in as belonging to the same night', () => {
    // Punched in at 00:20, i.e. 2h20m late for a 22:00 start.
    const { inMinutes, outMinutes } = normalisePunchPair(at(0, 20), at(6), 'NS');
    expect(inMinutes).toBe(at(24, 20));
    expect(outMinutes).toBe(at(30));

    const result = run('NS', { rawIn: at(0, 20), rawOut: at(6) });
    expect(result.calculatedWorkedMinutes).toBe(340);
    expect(result.punctualIn).toBe(false);
  });
});

describe('flagging (spec 12.4, 12.6)', () => {
  it('flags an incomplete punch and pays nothing until a duration is entered', () => {
    const result = run('OS', { rawIn: at(9), rawOut: null });
    expect(result.flags).toContain('INCOMPLETE_PUNCH');
    expect(result.calculatedWorkedMinutes).toBe(0);
    expect(result.needsManualDuration).toBe(true);
  });

  it('flags a Saturday with no punches as a normal absence', () => {
    const result = run('PS', { date: SATURDAY, status: 'WO' });
    expect(result.isWeeklyOff).toBe(false);
    expect(result.isExpectedWorkingDay).toBe(true);
    expect(result.flags).toContain('NO_PUNCH_ON_WORKING_DAY');
  });

  it('treats Saturday WOP exactly like a present day', () => {
    const wop = run('PS', { date: SATURDAY, status: 'WOP', rawIn: at(8), rawOut: at(17) });
    const present = run('PS', { date: TUESDAY, status: 'P', rawIn: at(8), rawOut: at(17) });
    expect(wop.calculatedWorkedMinutes).toBe(present.calculatedWorkedMinutes);
    expect(wop.flags).toEqual(present.flags);
  });

  it('does not flag an unpunched Sunday', () => {
    const result = run('PS', { date: SUNDAY, status: 'WO' });
    expect(result.isWeeklyOff).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it('flags punches that appear on a Sunday', () => {
    const result = run('PS', { date: SUNDAY, status: 'WOP', rawIn: at(8), rawOut: at(17) });
    expect(result.flags).toContain('WORKED_ON_WEEKLY_OFF');
  });

  it('does not flag an unpunched public holiday', () => {
    const result = run('PS', { status: 'A', isPublicHoliday: true });
    expect(result.flags).toEqual([]);
  });

  it('flags a 20-hour data anomaly through the same universal rule', () => {
    const result = run('PS', { rawIn: at(4), rawOut: at(23, 30) });
    // Pay is still capped to the shift, but the day is surfaced for review.
    expect(result.calculatedWorkedMinutes).toBe(480);
    expect(result.flags).toContain('POSSIBLE_OVERTIME');
    expect(result.uncreditedMinutes).toBe(240 + 390);
  });

  it('surfaces overtime that the shift-end cap would otherwise hide', () => {
    const result = run('OS', { rawIn: at(9), rawOut: at(20) });
    expect(result.calculatedWorkedMinutes).toBe(480);
    expect(result.lateDepartureMinutes).toBe(120);
    expect(result.flags).toContain('POSSIBLE_OVERTIME');
  });

  it('stays inside the 30-minute grace without raising an overtime flag', () => {
    const result = run('OS', { rawIn: at(8, 40), rawOut: at(18, 20) });
    expect(result.uncreditedMinutes).toBe(40);
    expect(result.flags).toContain('POSSIBLE_OVERTIME');

    const inside = run('OS', { rawIn: at(8, 55), rawOut: at(18, 20) });
    expect(inside.uncreditedMinutes).toBe(25);
    expect(inside.flags).toEqual([]);
  });
});

describe('human resolutions', () => {
  it('applies a manual duration to an incomplete punch', () => {
    const result = run(
      'OS',
      { rawIn: at(9), rawOut: null },
      resolution({ manualWorkedMinutes: 480, resolved: true }),
    );
    expect(result.workedMinutes).toBe(480);
    expect(result.payableMinutes).toBe(480);
    expect(result.needsManualDuration).toBe(false);
    expect(result.isResolved).toBe(true);
  });

  it('adds confirmed overtime and counts it toward punctuality and merit', () => {
    const result = run(
      'OS',
      { rawIn: at(9), rawOut: at(20) },
      resolution({ confirmedOtMinutes: 120, meritTicked: true, resolved: true }),
    );
    expect(result.creditedWorkMinutes).toBe(600);
    expect(result.flags).not.toContain('POSSIBLE_OVERTIME');
    expect(result.punctualityAwarded).toBe(true);
    expect(result.meritAwarded).toBe(true);
  });

  it('adds paid leave to payable time without counting it as worked', () => {
    const result = run(
      'OS',
      { rawIn: at(9), rawOut: at(13) },
      resolution({ tag: 'SANCTIONED_LEAVE', paidLeaveMinutes: 255, resolved: true }),
    );
    expect(result.creditedWorkMinutes).toBe(225);
    expect(result.payableMinutes).toBe(480);
    // Punctuality pays on worked time only, and the day is still flagged.
    expect(result.punctualityAwarded).toBe(false);
  });

  it('grants punctuality despite a discrepancy when overridden', () => {
    const result = run(
      'OS',
      { rawIn: at(9, 30), rawOut: at(18) },
      resolution({
        grantPunctualityOverride: true,
        punctualityOverrideNote: 'Traffic jam, approved by owner',
        resolved: true,
      }),
    );
    expect(result.isFlagged).toBe(true);
    expect(result.punctualityAwarded).toBe(true);
  });
});

describe('configurable rounding grace (Settings, docs/RULE-DECISIONS.md #1)', () => {
  const STRICT = { lateArrival: 0, earlyDeparture: 0 };
  const LENIENT = { lateArrival: 30, earlyDeparture: 30 };

  it('docks a 20-minute late arrival under the strict setting', () => {
    const result = computeDay(day({ rawIn: at(9, 20), rawOut: at(18) }), 'OS', EMPTY_RESOLUTION, STRICT);
    expect(result.calculatedWorkedMinutes).toBe(460);
    expect(result.flags).toContain('NOT_STANDARD_DAY');
    expect(result.punctualIn).toBe(false);
  });

  it('absorbs the same arrival under a 30-minute grace', () => {
    const result = computeDay(day({ rawIn: at(9, 20), rawOut: at(18) }), 'OS', EMPTY_RESOLUTION, LENIENT);
    expect(result.effectiveInMinutes).toBe(at(9));
    expect(result.calculatedWorkedMinutes).toBe(480);
    expect(result.flags).toEqual([]);
    expect(result.punctualityAwarded).toBe(true);
  });

  it('still docks a departure beyond the grace', () => {
    const result = computeDay(day({ rawIn: at(9), rawOut: at(17, 20) }), 'OS', EMPTY_RESOLUTION, LENIENT);
    expect(result.effectiveOutMinutes).toBe(at(17, 20));
    expect(result.flags).toContain('NOT_STANDARD_DAY');
  });

  it('never credits early arrival or late departure, whatever the grace', () => {
    const lenient = computeDay(day({ rawIn: at(8), rawOut: at(19) }), 'OS', EMPTY_RESOLUTION, LENIENT);
    expect(lenient.calculatedWorkedMinutes).toBe(480);
    expect(lenient.effectiveInMinutes).toBe(at(9));
    expect(lenient.effectiveOutMinutes).toBe(at(18));
  });

  it('rounds punches directly against a supplied grace', () => {
    expect(roundPunchIn(at(9, 25), 'OS', 30)).toBe(at(9));
    expect(roundPunchIn(at(9, 25), 'OS', 0)).toBe(at(9, 25));
    expect(roundPunchOut(at(17, 40), 'OS', 30)).toBe(at(18));
    expect(roundPunchOut(at(17, 40), 'OS', 0)).toBe(at(17, 40));
  });
});
