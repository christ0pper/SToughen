import { describe, expect, it } from 'vitest';
import { computeDay } from '@/domain/hours';
import { calculatePayroll, type PayrollInput } from '@/domain/pay';
import { makeDate } from '@/domain/time';
import { EMPTY_RESOLUTION, type DayResolution } from '@/domain/types';
import { punctualityRate } from '@/services/analyticsService';

const at = (h: number, m = 0) => h * 60 + m;

function day(dayOfMonth: number, resolution: Partial<DayResolution> = {}, worked = true) {
  return computeDay(
    {
      date: makeDate(2025, 7, dayOfMonth),
      status: worked ? 'P' : 'A',
      rawIn: worked ? at(9) : null,
      rawOut: worked ? at(18) : null,
    },
    'OS',
    { ...EMPTY_RESOLUTION, ...resolution },
  );
}

function input(days: ReturnType<typeof day>[]): PayrollInput {
  return {
    period: { year: 2025, month: 7 },
    employee: {
      id: 'e1',
      name: 'Test',
      kind: 'PUNCH',
      schedule: 'OS',
      joiningDate: makeDate(2020, 1, 1),
      esiApplicable: false,
      pfApplicable: false,
      rateHistory: [{ effectiveFrom: makeDate(2020, 1, 1), hourlyRate: 50 }],
    },
    days,
    manualDays: [],
    holidays: [],
    extras: [],
    oneOffDeductions: [],
    recurringDeductions: [],
    esiWageThreshold: null,
  };
}

describe('leave counting (the analytics "leaves taken" metric)', () => {
  it('counts each resolution tag into its own bucket', () => {
    const result = calculatePayroll(
      input([
        day(1, { tag: 'SANCTIONED_LEAVE', resolved: true }, false),
        day(2, { tag: 'SANCTIONED_LEAVE', resolved: true }, false),
        day(3, { tag: 'UNAUTHORIZED_ABSENCE', resolved: true }, false),
        day(4, { tag: 'HALF_DAY', resolved: true }, false),
        day(5, { tag: 'OTHER', note: 'Plant shutdown', resolved: true }, false),
        day(7),
      ]),
    );

    expect(result.daysSanctionedLeave).toBe(2);
    expect(result.daysUnauthorisedAbsence).toBe(1);
    expect(result.daysHalfDay).toBe(1);
    expect(result.daysOtherResolution).toBe(1);
  });

  it('counts a paid leave day separately from its tag', () => {
    const result = calculatePayroll(
      input([day(1, { tag: 'SANCTIONED_LEAVE', paidLeaveMinutes: 480, resolved: true }, false)]),
    );

    expect(result.daysSanctionedLeave).toBe(1);
    expect(result.daysPaidLeave).toBe(1);
    // Paid leave is paid but not worked, so it reaches base pay and no bonus.
    expect(result.basePay).toBe(8 * 50);
    expect(result.punctualityPay).toBe(0);
  });

  it('leaves every bucket at zero when nothing is tagged', () => {
    const result = calculatePayroll(input([day(1), day(2), day(3)]));
    expect(result.daysSanctionedLeave).toBe(0);
    expect(result.daysUnauthorisedAbsence).toBe(0);
    expect(result.daysHalfDay).toBe(0);
    expect(result.daysOtherResolution).toBe(0);
    expect(result.daysPaidLeave).toBe(0);
  });

  it('carries the tag onto the computed day so the counters can read it', () => {
    expect(day(1, { tag: 'HALF_DAY' }).resolutionTag).toBe('HALF_DAY');
    expect(day(1).resolutionTag).toBeNull();
  });
});

describe('punctuality rate', () => {
  it('is a share of days actually worked, not of days in the month', () => {
    expect(punctualityRate(11, 22)).toBe(50);
    expect(punctualityRate(22, 22)).toBe(100);
  });

  it('is null rather than zero when nothing was worked', () => {
    // Zero would read as "terrible punctuality" instead of "no data".
    expect(punctualityRate(0, 0)).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(punctualityRate(1, 3)).toBe(33.3);
  });
});
