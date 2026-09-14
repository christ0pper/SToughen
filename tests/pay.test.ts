import { describe, expect, it } from 'vitest';
import { computeDay } from '@/domain/hours';
import {
  calculatePayroll,
  isHolidayPayEligible,
  isSalariedFor,
  resolveHourlyRate,
  type PayrollEmployee,
  type PayrollInput,
} from '@/domain/pay';
import { makeDate } from '@/domain/time';
import { EMPTY_RESOLUTION, type DayComputation } from '@/domain/types';

const at = (h: number, m = 0) => h * 60 + m;

/** July 2025 working days (Sundays fall on the 6th, 13th, 20th and 27th). */
const JULY_WORKING_DAYS = [
  1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31,
];

/** `count` clean 09:00-18:00 OS days, optionally all ticked for merit. */
function cleanDays(count: number, meritTicked = false): DayComputation[] {
  return JULY_WORKING_DAYS.slice(0, count).map((dayOfMonth) =>
    computeDay(
      {
        date: makeDate(2025, 7, dayOfMonth),
        status: 'P',
        rawIn: at(9),
        rawOut: at(18),
      },
      'OS',
      { ...EMPTY_RESOLUTION, meritTicked },
    ),
  );
}

function employee(overrides: Partial<PayrollEmployee> = {}): PayrollEmployee {
  return {
    id: 'emp-1',
    name: 'Test Employee',
    kind: 'PUNCH',
    schedule: 'OS',
    joiningDate: makeDate(2020, 1, 1),
    esiApplicable: true,
    pfApplicable: true,
    rateHistory: [{ effectiveFrom: makeDate(2020, 1, 1), hourlyRate: 62.5 }],
    ...overrides,
  };
}

function input(overrides: Partial<PayrollInput> = {}): PayrollInput {
  return {
    period: { year: 2025, month: 7 },
    employee: employee(),
    days: [],
    manualDays: [],
    holidays: [],
    extras: [],
    oneOffDeductions: [],
    recurringDeductions: [],
    esiWageThreshold: 21000,
    ...overrides,
  };
}

describe('the full formula chain (spec 12.11)', () => {
  it('walks base -> bonuses -> gross -> statutory -> net -> final', () => {
    const result = calculatePayroll(
      input({
        days: cleanDays(22, true),
        oneOffDeductions: [{ amount: 500, reason: 'Damaged tool' }],
        recurringDeductions: [{ amount: 1000, reason: 'Staff quarters rent' }],
      }),
    );

    expect(result.workedHours).toBe(176); // 22 days x 8h
    expect(result.basePay).toBe(11000); // 176 x 62.50
    expect(result.punctualityPay).toBe(880); // 176h x Rs.5
    expect(result.meritPay).toBe(880); // spec 12.9 worked example
    expect(result.grossPay).toBe(12760);

    expect(result.esi).toBe(95.7); // 0.75%
    expect(result.pf).toBe(1531.2); // 12%, under the Rs.1800 cap
    expect(result.netPay).toBe(11133.1);

    expect(result.deductionTotal).toBe(1500);
    expect(result.finalPay).toBe(9633.1);
    expect(result.daysPunctual).toBe(22);
  });

  it('caps PF at Rs.1800', () => {
    const result = calculatePayroll(
      input({
        employee: employee({
          rateHistory: [{ effectiveFrom: makeDate(2020, 1, 1), hourlyRate: 100 }],
        }),
        days: cleanDays(22, true),
      }),
    );
    expect(result.grossPay).toBe(19360);
    expect(result.pf).toBe(1800); // 12% would be 2323.20
  });

  it('skips ESI and PF when the employee is not flagged for them', () => {
    const result = calculatePayroll(
      input({
        employee: employee({ esiApplicable: false, pfApplicable: false }),
        days: cleanDays(22),
      }),
    );
    expect(result.esi).toBe(0);
    expect(result.pf).toBe(0);
    expect(result.netPay).toBe(result.grossPay);
  });

  it('adds a discretionary extra straight into gross', () => {
    const result = calculatePayroll(
      input({ days: cleanDays(22), extras: [{ amount: 2500, reason: 'Diwali bonus' }] }),
    );
    expect(result.extraTotal).toBe(2500);
    expect(result.grossPay).toBe(11000 + 880 + 2500);
  });

  it('warns rather than silently paying a negative amount', () => {
    const result = calculatePayroll(
      input({ days: cleanDays(1), oneOffDeductions: [{ amount: 99999, reason: 'Recovery' }] }),
    );
    expect(result.finalPay).toBeLessThan(0);
    expect(result.warnings.join(' ')).toMatch(/exceed net pay/i);
  });
});

describe('public holiday pay (spec 12.10)', () => {
  it('pays 8 hours to an employee past 365 days of tenure', () => {
    const result = calculatePayroll(
      input({ days: cleanDays(22), holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }] }),
    );
    expect(result.holidayPay).toBe(500); // 8 x 62.50
    expect(result.holidayLines[0].eligible).toBe(true);
  });

  it('pays nothing to an employee short of 365 days', () => {
    const result = calculatePayroll(
      input({
        employee: employee({ joiningDate: makeDate(2025, 6, 1) }),
        days: cleanDays(22),
        holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }],
      }),
    );
    expect(result.holidayPay).toBe(0);
    expect(result.holidayLines[0].eligible).toBe(false);
  });

  it('stacks holiday pay on top of a worked holiday', () => {
    const worked = calculatePayroll(input({ days: cleanDays(22) }));
    const workedPlusHoliday = calculatePayroll(
      input({ days: cleanDays(22), holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }] }),
    );
    expect(workedPlusHoliday.grossPay - worked.grossPay).toBe(500);
  });

  it('measures tenure to the day', () => {
    expect(isHolidayPayEligible(makeDate(2024, 7, 15), makeDate(2025, 7, 15))).toBe(true);
    expect(isHolidayPayEligible(makeDate(2024, 7, 16), makeDate(2025, 7, 15))).toBe(false);
  });

  // The joining date is optional - somebody created from a punch file has no
  // first day on record until a human supplies one.
  it('pays nothing when there is no joining date to measure tenure from', () => {
    expect(isHolidayPayEligible(null, makeDate(2025, 7, 15))).toBe(false);

    const result = calculatePayroll(
      input({
        employee: employee({ joiningDate: null }),
        days: cleanDays(22),
        holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }],
      }),
    );
    expect(result.holidayPay).toBe(0);
    expect(result.holidayLines[0].eligible).toBe(false);
  });

  it('says WHY it paid nothing, so an unknown tenure is not read as a new joiner', () => {
    const unknown = calculatePayroll(
      input({
        employee: employee({ joiningDate: null }),
        days: cleanDays(22),
        holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }],
      }),
    );
    const tooNew = calculatePayroll(
      input({
        employee: employee({ joiningDate: makeDate(2025, 6, 1) }),
        days: cleanDays(22),
        holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }],
      }),
    );

    // Identical in the money, and entirely different to whoever has to fix it.
    expect(unknown.holidayPay).toBe(tooNew.holidayPay);
    expect(unknown.holidayLines[0].tenureUnknown).toBe(true);
    expect(tooNew.holidayLines[0].tenureUnknown).toBe(false);
  });

  it('pays as normal once the missing date is filled in', () => {
    const filledIn = calculatePayroll(
      input({
        employee: employee({ joiningDate: makeDate(2020, 1, 1) }),
        days: cleanDays(22),
        holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }],
      }),
    );
    expect(filledIn.holidayPay).toBe(500);
    expect(filledIn.holidayLines[0].tenureUnknown).toBe(false);
  });
});

describe('rate history (spec 12.12)', () => {
  it('picks the rate that was in force on the date', () => {
    const history = [
      { effectiveFrom: makeDate(2020, 1, 1), hourlyRate: 50 },
      { effectiveFrom: makeDate(2025, 7, 15), hourlyRate: 60 },
    ];
    expect(resolveHourlyRate(history, makeDate(2025, 7, 14))).toBe(50);
    expect(resolveHourlyRate(history, makeDate(2025, 7, 15))).toBe(60);
    expect(resolveHourlyRate(history, makeDate(2019, 12, 31))).toBeNull();
  });

  it('pays each day at its own rate across a mid-month raise', () => {
    const result = calculatePayroll(
      input({
        employee: employee({
          rateHistory: [
            { effectiveFrom: makeDate(2020, 1, 1), hourlyRate: 50 },
            { effectiveFrom: makeDate(2025, 7, 15), hourlyRate: 60 },
          ],
        }),
        // Working days 1-5, 7-12, 14, 15, 16 - the raise lands on the 15th.
        days: cleanDays(14),
      }),
    );
    // 12 days at the old rate (1-5, 7-12, 14), then the 15th and 16th at the new one.
    expect(result.basePay).toBe(12 * 8 * 50 + 2 * 8 * 60);
  });

  it('warns instead of silently paying zero when no rate covers a day', () => {
    const result = calculatePayroll(
      input({
        employee: employee({
          rateHistory: [{ effectiveFrom: makeDate(2026, 1, 1), hourlyRate: 70 }],
        }),
        days: cleanDays(3),
      }),
    );
    expect(result.basePay).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/no hourly rate/i);
  });
});

describe('exception roles (spec 11.5)', () => {
  it('pays entered hours with no punctuality or merit, ever', () => {
    const result = calculatePayroll(
      input({
        employee: employee({ kind: 'EXCEPTION', exceptionRole: 'MANAGER', schedule: 'OS' }),
        manualDays: JULY_WORKING_DAYS.slice(0, 22).map((d) => ({
          date: makeDate(2025, 7, d),
          hours: 8,
        })),
      }),
    );
    expect(result.workedHours).toBe(176);
    expect(result.basePay).toBe(11000);
    expect(result.punctualityPay).toBe(0);
    expect(result.meritPay).toBe(0);
  });

  it('has no statutory deduction by default, matching spec 12.11', () => {
    // The employee record's own flags decide this - unset by default for a
    // newly created exception-role employee (see the employee form).
    const result = calculatePayroll(
      input({
        employee: employee({
          kind: 'EXCEPTION',
          exceptionRole: 'MANAGER',
          schedule: 'OS',
          esiApplicable: false,
          pfApplicable: false,
        }),
        manualDays: JULY_WORKING_DAYS.slice(0, 22).map((d) => ({ date: makeDate(2025, 7, d), hours: 8 })),
      }),
    );
    expect(result.esi).toBe(0);
    expect(result.pf).toBe(0);
    expect(result.grossPay).toBe(11000);
  });

  it('still calculates ESI/PF when explicitly ticked on for this employee', () => {
    // Spec 14.3 puts the ESI/PF flags on every employee record with no
    // exemption for exception roles - so a manager or driver who does carry
    // the deduction can be opted in via that same flag.
    const result = calculatePayroll(
      input({
        employee: employee({
          kind: 'EXCEPTION',
          exceptionRole: 'DRIVER',
          schedule: 'PS',
          esiApplicable: true,
          pfApplicable: true,
        }),
        manualDays: JULY_WORKING_DAYS.slice(0, 22).map((d) => ({ date: makeDate(2025, 7, d), hours: 8 })),
      }),
    );
    expect(result.grossPay).toBe(11000);
    expect(result.esi).toBe(82.5); // 0.75% of 11000
    expect(result.pf).toBe(1320); // 12% of 11000, under the cap
  });
});

describe('review gates', () => {
  it('warns while flagged days are still unresolved', () => {
    const flagged = computeDay(
      { date: makeDate(2025, 7, 1), status: 'P', rawIn: at(9, 30), rawOut: at(18) },
      'OS',
    );
    const result = calculatePayroll(input({ days: [...cleanDays(5), flagged] }));
    expect(result.daysUnresolved).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/unresolved/i);
  });

  it('warns when gross pay clears the configured ESI threshold', () => {
    const result = calculatePayroll(
      input({
        employee: employee({
          rateHistory: [{ effectiveFrom: makeDate(2020, 1, 1), hourlyRate: 200 }],
        }),
        days: cleanDays(22),
        esiWageThreshold: 21000,
      }),
    );
    expect(result.grossPay).toBeGreaterThan(21000);
    expect(result.warnings.join(' ')).toMatch(/ESI wage threshold/i);
  });

  it('says so when no ESI threshold has been configured', () => {
    const result = calculatePayroll(input({ days: cleanDays(5), esiWageThreshold: null }));
    expect(result.warnings.join(' ')).toMatch(/no ESI wage threshold/i);
  });
});

/**
 * Fixed monthly salary. July 2025 has 31 days, so a salary of 31,000 is exactly
 * 1,000 a day and every proration below can be checked by eye.
 */
describe('fixed monthly salary', () => {
  const salaried = (overrides: Partial<PayrollEmployee> = {}): PayrollEmployee =>
    employee({
      kind: 'SALARIED',
      esiApplicable: false,
      pfApplicable: false,
      rateHistory: [
        { effectiveFrom: makeDate(2020, 1, 1), payBasis: 'MONTHLY', hourlyRate: 0, monthlySalary: 31000 },
      ],
      ...overrides,
    });

  it('pays exactly the salary for a full month', () => {
    const result = calculatePayroll(input({ employee: salaried() }));
    expect(result.basePay).toBe(31000);
    expect(result.grossPay).toBe(31000);
    expect(result.warnings).toEqual([]);
  });

  it('pays the full salary even with no punches at all', () => {
    // Three of the five salaried staff in the real July file never punched. Read
    // as absence, that would have paid them nothing.
    const result = calculatePayroll(input({ employee: salaried(), days: [] }));
    expect(result.grossPay).toBe(31000);
    expect(result.daysAbsent).toBe(0);
  });

  it('adds no overtime, punctuality, merit or holiday pay on top', () => {
    const result = calculatePayroll(
      input({
        employee: salaried(),
        days: cleanDays(22, true),
        holidays: [{ date: makeDate(2025, 7, 15), name: 'Local holiday' }],
      }),
    );
    expect(result.punctualityPay).toBe(0);
    expect(result.meritPay).toBe(0);
    expect(result.holidayPay).toBe(0);
    expect(result.holidayLines).toEqual([]);
    expect(result.grossPay).toBe(31000);
  });

  it('prorates a mid-month raise by calendar day', () => {
    const result = calculatePayroll(
      input({
        employee: salaried({
          rateHistory: [
            { effectiveFrom: makeDate(2020, 1, 1), payBasis: 'MONTHLY', hourlyRate: 0, monthlySalary: 31000 },
            { effectiveFrom: makeDate(2025, 7, 16), payBasis: 'MONTHLY', hourlyRate: 0, monthlySalary: 62000 },
          ],
        }),
      }),
    );
    // 15 days at 1,000 + 16 days at 2,000
    expect(result.basePay).toBe(15000 + 32000);
  });

  it('pays a mid-month joiner only from their first day', () => {
    const result = calculatePayroll(
      input({ employee: salaried({ joiningDate: makeDate(2025, 7, 17) }) }),
    );
    expect(result.basePay).toBe(15000); // the 17th to the 31st
  });

  it('stops paying after the day someone left', () => {
    const result = calculatePayroll(input({ employee: salaried({ leftOn: makeDate(2025, 7, 10) }) }));
    expect(result.basePay).toBe(10000); // the 1st to the 10th
  });

  it('pays full salary when no joining date is recorded', () => {
    const result = calculatePayroll(input({ employee: salaried({ joiningDate: null }) }));
    expect(result.basePay).toBe(31000);
  });

  it('applies ESI and PF to the salary when they are switched on', () => {
    const result = calculatePayroll(
      input({ employee: salaried({ esiApplicable: true, pfApplicable: true }), esiWageThreshold: null }),
    );
    expect(result.esi).toBeGreaterThan(0);
    expect(result.pf).toBeGreaterThan(0);
    expect(result.netPay).toBe(Math.round((31000 - result.esi - result.pf) * 100) / 100);
  });

  it('says so when part of the month has no salary on record', () => {
    const result = calculatePayroll(
      input({
        employee: salaried({
          rateHistory: [
            { effectiveFrom: makeDate(2025, 7, 11), payBasis: 'MONTHLY', hourlyRate: 0, monthlySalary: 31000 },
          ],
        }),
      }),
    );
    expect(result.basePay).toBe(21000); // the 11th to the 31st
    expect(result.warnings.join(' ')).toMatch(/No salary is on record for 10 day/);
  });

  it('refuses to guess when pay switches from hourly to salary mid-month', () => {
    const result = calculatePayroll(
      input({
        employee: salaried({
          rateHistory: [
            { effectiveFrom: makeDate(2020, 1, 1), payBasis: 'HOURLY', hourlyRate: 62.5 },
            { effectiveFrom: makeDate(2025, 7, 21), payBasis: 'MONTHLY', hourlyRate: 0, monthlySalary: 31000 },
          ],
        }),
      }),
    );
    expect(result.basePay).toBe(11000); // only the salaried 21st to 31st
    expect(result.warnings.join(' ')).toMatch(/check this month by hand/);
  });

  it('reports no hourly rate for a salaried day, rather than a misleading zero', () => {
    const history = [
      { effectiveFrom: makeDate(2020, 1, 1), payBasis: 'MONTHLY' as const, hourlyRate: 0, monthlySalary: 31000 },
    ];
    expect(resolveHourlyRate(history, makeDate(2025, 7, 15))).toBeNull();
    expect(isSalariedFor(history, 2025, 7)).toBe(true);
    expect(isSalariedFor([{ effectiveFrom: makeDate(2020, 1, 1), hourlyRate: 62.5 }], 2025, 7)).toBe(false);
  });

  it('decides the month by the basis in force on its last day', () => {
    const switchedLate = [
      { effectiveFrom: makeDate(2020, 1, 1), payBasis: 'HOURLY' as const, hourlyRate: 62.5 },
      { effectiveFrom: makeDate(2025, 7, 31), payBasis: 'MONTHLY' as const, hourlyRate: 0, monthlySalary: 31000 },
    ];
    expect(isSalariedFor(switchedLate, 2025, 7)).toBe(true);
    expect(isSalariedFor(switchedLate, 2025, 6)).toBe(false);
  });
});
