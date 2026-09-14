import { db } from '@/lib/db';
import { getSession, isAdmin } from '@/lib/auth';
import { getEsiWageThreshold, getRoundingGrace } from '@/lib/settings';
import { BREAKS, PAY_RULES, SCHEDULES } from '@/domain/config';
import { formatClock } from '@/domain/time';
import { rupees, shortDate } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import {
  addHolidayAction,
  removeHolidayAction,
  setEsiThresholdAction,
  setRoundingGraceAction,
} from '@/actions/settings';
import { changeOwnPasswordAction } from '@/actions/users';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getSession();
  const admin = isAdmin(user);

  const [holidays, threshold, grace] = await Promise.all([
    db.holiday.findMany({ orderBy: { date: 'asc' } }),
    getEsiWageThreshold(),
    getRoundingGrace(),
  ]);

  return (
    <div className="space-y-6">

      {/* rounding grace ---------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Punch rounding grace</h2>
          <span className="text-xs text-ink-soft">Admin only · affects every calculation</span>
        </div>
        <div className="px-5 pb-5">
          <p className="mb-1 max-w-3xl text-sm text-ink-soft">
            How much lateness or early leaving is absorbed before it reduces payable hours. Arriving
            early and leaving late are never paid extra — that is fixed policy. This setting only
            governs the other two directions.
          </p>
          <p className="mb-3 max-w-3xl text-sm text-ink-soft">
            <strong>0 minutes</strong> means every late minute reduces pay and sends the day to the
            flagged-days queue for review. <strong>30 minutes</strong> absorbs small discrepancies
            silently. The difference is large: on sample data the strict setting flags roughly{' '}
            <strong>69%</strong> of days against <strong>7%</strong> at 30 minutes. Run{' '}
            <code className="rounded bg-well px-1 py-0.5 text-xs">npm run compare-grace</code>{' '}
            against a real export to measure it on your own numbers.
          </p>

          {admin ? (
            <ActionForm action={setRoundingGraceAction} submitLabel="Save grace">
              <div className="mb-3 grid max-w-lg gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Late-arrival grace (minutes)</label>
                  <input
                    name="lateArrivalGrace"
                    type="number"
                    min="0"
                    max="120"
                    step="1"
                    className="input"
                    defaultValue={grace.lateArrival}
                  />
                </div>
                <div>
                  <label className="label">Early-departure grace (minutes)</label>
                  <input
                    name="earlyDepartureGrace"
                    type="number"
                    min="0"
                    max="120"
                    step="1"
                    className="input"
                    defaultValue={grace.earlyDeparture}
                  />
                </div>
              </div>
              <p className="mb-3 text-xs text-ink-soft">
                Changing this does not rewrite history. A draft period picks it up on the next
                recalculation; a locked period keeps its approved figures until an Admin reopens and
                recalculates it.
              </p>
            </ActionForm>
          ) : (
            <p className="text-sm">
              Current: late arrival{' '}
              <span className="font-medium">{grace.lateArrival} min</span>, early departure{' '}
              <span className="font-medium">{grace.earlyDeparture} min</span>.
            </p>
          )}
        </div>
      </section>

      {/* ESI threshold ----------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">ESI wage threshold</h2>
          <span className="text-xs text-ink-soft">Admin only</span>
        </div>
        <div className="px-5 pb-5">
          <p className="mb-3 max-w-2xl text-sm text-ink-soft">
            When gross pay exceeds this amount, the payroll warns that ESI may no longer apply. No
            statutory figure is assumed — until you set a number here, no threshold check runs.
          </p>
          {admin ? (
            <ActionForm action={setEsiThresholdAction} submitLabel="Save threshold">
              <div className="mb-3 w-56">
                <label className="label">Monthly gross threshold</label>
                <input
                  name="threshold"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  defaultValue={threshold ?? ''}
                  placeholder="Not set"
                />
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm">
              Current:{' '}
              {threshold == null ? (
                <span className="text-amber-700">not set</span>
              ) : (
                <span className="font-medium">{rupees(threshold)}</span>
              )}
            </p>
          )}
        </div>
      </section>

      {/* holidays ---------------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Public holidays</h2>
          <span className="text-xs text-ink-soft">
            Paid at 8 × hourly rate to anyone past {PAY_RULES.holidayTenureDays} days of tenure
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-sm text-ink-soft">
                    No holidays declared.
                  </td>
                </tr>
              ) : (
                holidays.map((holiday) => (
                  <tr key={holiday.id}>
                    <td>{shortDate(holiday.date)}</td>
                    <td>{holiday.name}</td>
                    <td className="text-right">
                      {admin ? (
                        <ActionForm
                          action={removeHolidayAction}
                          hidden={{ holidayId: holiday.id }}
                          submitLabel="Remove"
                          confirm="Remove this holiday? Recalculate any affected period afterwards."
                        />
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {admin ? (
          <div className="border-t border-hairline px-5 py-4">
            <ActionForm action={addHolidayAction} submitLabel="Declare holiday">
              <div className="mb-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Date</label>
                  <input name="date" type="date" className="input" required />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Name</label>
                  <input name="name" className="input" required placeholder="Independence Day" />
                </div>
              </div>
            </ActionForm>
          </div>
        ) : null}
      </section>

      {/* your password ------------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Your password</h2>
          <span className="text-xs text-ink-soft">at least 12 characters</span>
        </div>
        <div className="px-5 pb-5">
          <ActionForm action={changeOwnPasswordAction} submitLabel="Change password">
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Current password</label>
                <input
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">New password</label>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Confirm new password</label>
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  required
                />
              </div>
            </div>
          </ActionForm>
        </div>
      </section>

      {/* rules reference ---------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Company rules in force</h2>
          <span className="text-xs text-ink-soft">Defined in code — see src/domain/config.ts</span>
        </div>

        <div className="grid gap-6 p-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Schedules
            </h3>
            <ul className="space-y-1 text-sm text-ink-soft">
              {Object.values(SCHEDULES).map((schedule) => (
                <li key={schedule.code}>
                  <span className="font-medium">{schedule.code}</span> — {schedule.label},{' '}
                  {formatClock(schedule.startMinutes)}–{formatClock(schedule.endMinutes)}
                  {schedule.breaksApply ? '' : ' · no break deduction'}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Unpaid breaks
            </h3>
            <ul className="space-y-1 text-sm text-ink-soft">
              {BREAKS.map((brk) => (
                <li key={brk.key}>
                  <span className="font-medium">{brk.label}</span> — {brk.durationMinutes} min within{' '}
                  {formatClock(brk.windowStart)}–{formatClock(brk.windowEnd)} (PS{' '}
                  {formatClock(brk.slotStart.PS)}, OS {formatClock(brk.slotStart.OS)})
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Rounding
            </h3>
            <ul className="space-y-1 text-sm text-ink-soft">
              <li>Early arrival is never credited — punch-in rounds up to shift start.</li>
              <li>Late departure is capped at shift end; extra time needs overtime confirmation.</li>
              <li>
                Late-arrival grace: {grace.lateArrival} min · early-departure grace:{' '}
                {grace.earlyDeparture} min — set above, not in code.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Pay
            </h3>
            <ul className="space-y-1 text-sm text-ink-soft">
              <li>Standard day: {PAY_RULES.standardWorkdayMinutes / 60} hours, excluding breaks.</li>
              <li>Punctuality and merit: ₹{PAY_RULES.punctualityRatePerHour} per worked hour each.</li>
              <li>ESI: {(PAY_RULES.esiRate * 100).toFixed(2)}% of gross.</li>
              <li>
                PF: {(PAY_RULES.pfRate * 100).toFixed(0)}% of gross, capped at{' '}
                {rupees(PAY_RULES.pfCapAmount)}.
              </li>
              <li>
                ESI/PF apply per employee (Employees screen), not by rule. New workers
                default to on, new exception roles (salesman, manager, security,
                driver) default to off — either can be ticked for a specific person.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
