import Link from 'next/link';
import { db } from '@/lib/db';
import { LineChart } from '@/components/charts/LineChart';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { ComparisonTable } from '@/components/charts/ComparisonTable';
import { CHART } from '@/components/charts/tokens';
import { KpiStrip } from '@/components/panels/KpiStrip';
import { CountChip, Meter } from '@/components/panels/Meters';
import {
  getDraftPeriods,
  getEmployeeComparison,
  getPeriodTrend,
  getSelectablePeriods,
} from '@/services/analyticsService';
import { actionLabel, actorLabel, entityLabel, SIGNIFICANT_ACTIONS } from '@/lib/auditFormat';
import { dateTime, hours as formatHours, periodLabel, rupees } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Short axis label - "Jul 25" fits where "July 2025" does not. */
function shortPeriod(year: number, month: number): string {
  return `${periodLabel(year, month).slice(0, 3)} ${String(year).slice(2)}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;

  const [trend, drafts, periods, activity] = await Promise.all([
    // Approved only. A draft's totals move every time somebody clears a queue
    // item, so letting them in here would make the company's headline payroll
    // cost drift during review and quote a figure nobody has signed off.
    getPeriodTrend(24, { approvedOnly: true }),
    getDraftPeriods(),
    getSelectablePeriods(),
    db.auditLog.findMany({
      include: {
        user: { select: { name: true } },
        period: { select: { year: true, month: true } },
      },
      orderBy: { at: 'desc' },
      take: 6,
    }),
  ]);

  const scopeId = periodParam && periodParam !== 'all' ? periodParam : null;
  const comparison = await getEmployeeComparison(scopeId);
  const scopeLabel = scopeId
    ? (() => {
        const found = periods.find((p) => p.id === scopeId);
        return found ? periodLabel(found.year, found.month) : 'Selected period';
      })()
    : 'All periods on record';

  const latest = trend.at(-1) ?? null;
  const labels = trend.map((point) => shortPeriod(point.year, point.month));

  // The four headline figures, each shown with the two parts it divides into.
  const kpis = latest
    ? [
        {
          label: 'Final payable',
          value: rupees(latest.finalPay),
          parts: [
            { label: 'Gross', value: rupees(latest.grossPay), tone: 'brand' as const },
            { label: 'Deductions', value: rupees(latest.deductionTotal), tone: 'bad' as const },
          ],
        },
        {
          label: 'Days worked',
          value: String(latest.daysPresent),
          parts: [
            { label: 'Punctual', value: String(latest.punctualDays), tone: 'brand' as const },
            { label: 'Absent', value: String(latest.daysAbsent), tone: 'bad' as const },
          ],
        },
        {
          label: 'Payable hours',
          value: formatHours(latest.payableHours),
          parts: [
            { label: 'Worked', value: formatHours(latest.payableHours - latest.overtimeHours), tone: 'brand' as const },
            { label: 'Overtime', value: formatHours(latest.overtimeHours), tone: 'brand' as const },
          ],
        },
        {
          label: 'Leave days',
          value: String(latest.leaveDays),
          parts: [
            { label: 'Sanctioned', value: String(latest.sanctionedLeave), tone: 'brand' as const },
            { label: 'Unauthorised', value: String(latest.unauthorisedAbsence), tone: 'bad' as const },
          ],
        },
      ]
    : [];

  // Every meter is drawn against total payable hours, so their lengths compare.
  const hoursTotal = latest?.payableHours ?? 0;
  const worked = hoursTotal - (latest?.overtimeHours ?? 0);
  const meters = latest
    ? [
        { label: 'Total payable', value: formatHours(hoursTotal), share: 1 },
        { label: 'Worked', value: formatHours(worked), share: hoursTotal ? worked / hoursTotal : 0 },
        {
          label: 'Overtime',
          value: formatHours(latest.overtimeHours),
          share: hoursTotal ? latest.overtimeHours / hoursTotal : 0,
        },
        {
          label: 'Merit days',
          value: String(latest.meritDays),
          share: latest.daysPresent ? latest.meritDays / latest.daysPresent : 0,
        },
      ]
    : [];

  return (
    <div className="space-y-7">
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Attendance and pay history across every period on record.
        </p>
      </div>

      {drafts.length > 0 ? (
        <section className="alert alert-warn">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <strong className="block font-semibold text-ink">
                {drafts.length} period{drafts.length === 1 ? '' : 's'} waiting to be approved
              </strong>
              <p className="mt-0.5 max-w-3xl text-[13px]">
                Nothing below counts these. A draft is still being reviewed, so its totals move
                every time a queue item is cleared — approving a period is what makes it a figure
                the business can quote.
              </p>
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  href={`/periods/${draft.id}`}
                  className="inline-flex items-baseline gap-2 rounded-md border border-warn-ring bg-white px-3 py-1.5 transition hover:border-ink-muted"
                >
                  <span className="text-[13px] font-medium text-ink">{draft.label}</span>
                  <span className="text-xs text-ink-muted">
                    {draft.employeeCount} people · {rupees(draft.finalPay)} provisional
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {trend.length === 0 ? (
        <section className="card p-10 text-center">
          <h2 className="section-title">
            {drafts.length > 0 ? 'Nothing approved yet' : 'Nothing to chart yet'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            {drafts.length > 0
              ? 'This dashboard reports approved periods. Clear the review queues on a draft and approve it, and its figures appear here.'
              : "This fills in once a month has been imported, calculated and approved. The run goes: add your employees, start a period, upload that month's biometric export, clear the review queues, then approve."}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/employees" className="btn">
              Add employees
            </Link>
            <Link href="/periods" className="btn btn-primary">
              Start a period
            </Link>
          </div>
        </section>
      ) : (
        <>
          {/* ---- overview ---------------------------------------------- */}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="section-title">Overview</h2>
              <span className="pill pill-brand">{latest?.label}</span>
              <span className="pill pill-good">Approved</span>
              <span className="text-xs text-ink-muted">latest approved period</span>
            </div>

            <KpiStrip cells={kpis} />
          </section>

          {/* ---- this period ------------------------------------------------ */}
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">This period</h2>
              <span className="card-note">{latest?.label}</span>
            </div>
            <div className="grid gap-8 px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
              <div>
                <h3 className="mb-3 text-[13px] font-semibold text-ink">Days</h3>
                <div className="grid grid-cols-3 gap-3">
                  <CountChip value={String(latest?.daysPresent ?? 0)} caption="Present" />
                  <CountChip value={String(latest?.daysAbsent ?? 0)} caption="Absent" />
                  <CountChip value={String(latest?.unresolvedFlags ?? 0)} caption="Unresolved" />
                </div>
                <p className="mt-3 text-xs text-ink-muted">
                  Across {latest?.headcount ?? 0} employees in payroll.
                </p>
              </div>

              <div>
                <h3 className="mb-3 text-[13px] font-semibold text-ink">Hours</h3>
                <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  {meters.map((meter) => (
                    <Meter key={meter.label} {...meter} />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ---- recent activity -------------------------------------------- */}
          <section className="card overflow-hidden">
            <div className="card-head">
              <h2 className="card-title">Recent activity</h2>
              <Link href="/audit" className="text-xs text-brand hover:underline">
                Full audit trail
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>When</th>
                    <th>Who</th>
                    <th>Period</th>
                    <th>What changed</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-ink-muted">
                        Nothing recorded yet.
                      </td>
                    </tr>
                  ) : (
                    activity.map((log) => (
                      <tr key={log.id}>
                        <td>
                          <span
                            className={`pill ${
                              SIGNIFICANT_ACTIONS.has(log.action) ? 'pill-soft-warn' : 'pill-neutral'
                            }`}
                          >
                            {actionLabel(log.action)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-xs">{dateTime(log.at)}</td>
                        <td className="text-xs">{actorLabel(log.user?.name)}</td>
                        <td className="whitespace-nowrap text-xs">
                          {log.period
                            ? periodLabel(log.period.year, log.period.month)
                            : '\u2014'}
                        </td>
                        <td className="text-xs text-ink-soft">
                          {entityLabel(log.entityType)}
                          {log.field ? ` \u00b7 ${log.field}` : ''}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---- trends ---------------------------------------------------- */}
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Payroll cost over time</h2>
              <span className="card-note">every period on record</span>
            </div>
            <div className="px-5 pb-5">
              <LineChart
                labels={labels}
                caption="Gross and final payroll cost per period"
                format="rupees"
                formatTick="rupeesCompact"
                series={[
                  { key: 'gross', label: 'Gross pay', values: trend.map((p) => p.grossPay) },
                  { key: 'final', label: 'Final payable', values: trend.map((p) => p.finalPay) },
                ]}
              />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Punctuality rate</h2>
                <span className="card-note">share of worked days fully on time</span>
              </div>
              <div className="px-5 pb-5">
                <LineChart
                  labels={labels}
                  caption="Punctuality rate per period"
                  fillArea
                  maxOverride={100}
                  format="percent"
                  series={[
                    {
                      key: 'punctuality',
                      label: 'Punctuality rate',
                      values: trend.map((p) => p.punctualityRate),
                    },
                  ]}
                />
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Hours worked</h2>
                <span className="card-note">payable hours across all employees</span>
              </div>
              <div className="px-5 pb-5">
                <LineChart
                  labels={labels}
                  caption="Total payable hours per period"
                  fillArea
                  format="hours"
                  formatTick="compact"
                  series={[
                    {
                      key: 'hours',
                      label: 'Payable hours',
                      values: trend.map((p) => p.payableHours),
                    },
                  ]}
                />
              </div>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Leave taken</h2>
                <span className="card-note">days, by how each was resolved</span>
              </div>
              <div className="px-5 pb-5">
                <StackedBarChart
                  labels={labels}
                  caption="Leave days per period by resolution type"
                  format="integer"
                  series={[
                    {
                      key: 'sanctioned',
                      label: 'Sanctioned leave',
                      values: trend.map((p) => p.sanctionedLeave),
                    },
                    {
                      key: 'unauthorised',
                      label: 'Unauthorised absence',
                      values: trend.map((p) => p.unauthorisedAbsence),
                    },
                    { key: 'half', label: 'Half day', values: trend.map((p) => p.halfDays) },
                    {
                      key: 'other',
                      label: 'Other',
                      values: trend.map((p) => p.otherResolution),
                      // Residual bucket takes the de-emphasis grey, not a fourth hue.
                      color: CHART.deEmphasis,
                    },
                  ]}
                />
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Deductions and statutory</h2>
                <span className="card-note">withheld from gross each period</span>
              </div>
              <div className="px-5 pb-5">
                <StackedBarChart
                  labels={labels}
                  caption="ESI, PF and other deductions per period"
                  format="rupees"
                  formatTick="rupeesCompact"
                  series={[
                    {
                      key: 'deductions',
                      label: 'Deductions',
                      values: trend.map((p) => p.deductionTotal),
                    },
                    { key: 'pf', label: 'PF', values: trend.map((p) => p.pf) },
                    { key: 'esi', label: 'ESI', values: trend.map((p) => p.esi) },
                  ]}
                />
              </div>
            </section>
          </div>

          {/* ---- comparison, with its own scope ---------------------------- */}
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="section-title">Employee comparison</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Showing {scopeLabel}. Click a column to sort.
                </p>
              </div>

              {/* one filter row, above the content it scopes */}
              <form method="get" className="flex items-end gap-2">
                <div>
                  <label className="label" htmlFor="period">
                    Scope
                  </label>
                  <select
                    id="period"
                    name="period"
                    className="input w-56"
                    defaultValue={scopeId ?? 'all'}
                  >
                    <option value="all">All periods on record</option>
                    {periods.map((option) => (
                      <option key={option.id} value={option.id}>
                        {periodLabel(option.year, option.month)}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn">
                  Apply
                </button>
              </form>
            </div>

            <div className="card overflow-hidden">
              <ComparisonTable rows={comparison} />
            </div>
          </section>

          <p className="text-xs text-ink-muted">
            Metrics shown are the set the specification confirms: hours worked, days worked, leave
            taken, deductions, punctuality trend, and cross-employee comparison. Further metrics are
            deliberately not invented here — see section 23 of the product spec.
          </p>
        </>
      )}
    </div>
  );
}
