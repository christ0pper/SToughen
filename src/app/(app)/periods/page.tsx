import Link from 'next/link';
import { db } from '@/lib/db';
import { periodLabel, rupees, dateTime } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { createPeriodAction } from '@/actions/periods';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default async function PeriodsPage() {
  const periods = await db.payrollPeriod.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: {
      lockedBy: { select: { name: true } },
      _count: { select: { payrollLines: true } },
    },
  });

  const totals = await db.payrollLine.groupBy({
    by: ['periodId'],
    where: { inPayroll: true },
    _sum: { finalPay: true },
    _count: { _all: true },
  });
  const totalByPeriod = new Map(
    totals.map((row) => [row.periodId, { final: row._sum.finalPay ?? 0, count: row._count._all }]),
  );

  const employeeCount = await db.employee.count();
  const openPeriod = periods.find((period) => period.status === 'DRAFT') ?? null;
  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="page-title">Payroll periods</h1>
          <p className="mt-1 text-sm text-ink-soft">
            One period per month. Upload the biometric export, resolve the queues, then approve.
          </p>
        </div>
      </div>

      {openPeriod && employeeCount > 0 ? (
        <section className="card flex flex-wrap items-center justify-between gap-4 bg-brand-soft p-5 ring-brand-ring">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {periodLabel(openPeriod.year, openPeriod.month)} is open
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Upload this month&apos;s biometric Excel export into it — that is where the attendance
              data comes from. You can re-upload a corrected file any time; it refreshes the punches
              and keeps every review already done.
            </p>
          </div>
          <Link href={`/periods/${openPeriod.id}`} className="btn btn-primary shrink-0">
            Upload the monthly file
          </Link>
        </section>
      ) : null}

      {employeeCount === 0 ? (
        <section className="alert alert-warn p-5">
          <h2 className="text-sm font-semibold text-ink">Add your employees first</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            A payroll run matches the biometric file to people already on record, so there is
            nothing for it to calculate yet. Add your staff, then come back and start a period.
          </p>
          <Link href="/employees" className="btn btn-primary mt-3 inline-flex">
            Go to Employees
          </Link>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Start a period</h2>
          <span className="card-note">one per month</span>
        </div>
        <div className="px-5 pb-5">
          <ActionForm action={createPeriodAction} submitLabel="Create period" variant="primary">
            <div className="mb-3 flex flex-wrap gap-3">
              <div className="w-40">
                <label className="label" htmlFor="month">
                  Month
                </label>
                <select id="month" name="month" className="input" defaultValue={now.getMonth() + 1}>
                  {MONTHS.map((label, index) => (
                    <option key={label} value={index + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="label" htmlFor="year">
                  Year
                </label>
                <input
                  id="year"
                  name="year"
                  type="number"
                  className="input"
                  defaultValue={now.getFullYear()}
                  min={2000}
                  max={2100}
                />
              </div>
            </div>
          </ActionForm>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="card-title">All periods</h2>
          <span className="text-xs text-ink-soft">{periods.length} on record</span>
        </div>

        {periods.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-muted">
            No periods yet. Pick a month above and create one — then upload that month&apos;s
            biometric export inside it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="num">Employees</th>
                  <th className="num">Total final pay</th>
                  <th>Locked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => {
                  const totals = totalByPeriod.get(period.id);
                  const locked = period.status === 'LOCKED';
                  return (
                    <tr key={period.id}>
                      <td className="font-medium text-ink">
                        {periodLabel(period.year, period.month)}
                        {period.reopenCount > 0 ? (
                          <span className="ml-2 pill pill-soft-warn">
                            reopened ×{period.reopenCount}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`pill ${
                            locked ? 'pill-good' : 'pill-neutral'
                          }`}
                        >
                          {locked ? 'Locked' : 'Draft'}
                        </span>
                      </td>
                      <td className="num">{totals?.count ?? 0}</td>
                      <td className="num">{totals ? rupees(totals.final) : '—'}</td>
                      <td className="text-xs text-ink-soft">
                        {period.lockedAt
                          ? `${dateTime(period.lockedAt)}${period.lockedBy?.name ? ` by ${period.lockedBy.name}` : ''}`
                          : '—'}
                      </td>
                      <td className="text-right">
                        <Link className="btn" href={`/periods/${period.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
