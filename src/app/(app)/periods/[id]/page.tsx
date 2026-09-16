import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSession, isAdmin } from '@/lib/auth';
import { checkReadiness, getFlaggedDays } from '@/services/payrollService';
import { dateTime, hours, periodLabel, rupees, scheduleName, shortDate } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { FlaggedDayCard } from '@/components/period/FlaggedDayCard';
import {
  deletePeriodAction,
  lockPeriodAction,
  recalculateAction,
  reopenPeriodAction,
  createAllUnmatchedAction,
  resolveUnmatchedAction,
  uploadFileAction,
  zeroPunchDecisionAction,
} from '@/actions/periods';

export const dynamic = 'force-dynamic';

const FLAGGED_PAGE_SIZE = 40;

export default async function PeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flagged?: string }>;
}) {
  const { id } = await params;
  const flaggedPage = Math.max(1, Number((await searchParams).flagged ?? 1) || 1);
  const user = await getSession();

  const period = await db.payrollPeriod.findUnique({
    where: { id },
    include: { lockedBy: { select: { name: true } } },
  });
  if (!period) notFound();

  const locked = period.status === 'LOCKED';
  const admin = isAdmin(user);

  const [readiness, unmatched, blockStatuses, zeroPunch, flagged, lines, employees, auditLogs, exceptionCount] =
    await Promise.all([
    checkReadiness(id),
    db.unmatchedBlock.findMany({ where: { periodId: id, status: 'PENDING' }, orderBy: { deviceId: 'asc' } }),
    db.unmatchedBlock.groupBy({ by: ['status'], where: { periodId: id }, _count: true }),
    db.zeroPunchReview.findMany({
      where: { periodId: id, decision: null },
      include: { employee: { select: { name: true, employeeCode: true, deviceId: true } } },
      orderBy: { employee: { name: 'asc' } },
    }),
    getFlaggedDays(id),
    db.payrollLine.findMany({
      where: { periodId: id },
      include: {
        employee: { select: { name: true, employeeCode: true, scheduleType: true, exceptionRole: true } },
      },
      orderBy: { employee: { name: 'asc' } },
    }),
    db.employee.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, employeeCode: true } }),
    db.auditLog.findMany({
      where: { periodId: id },
      include: { user: { select: { name: true } } },
      orderBy: { at: 'desc' },
      take: 20,
    }),
    db.employee.count({ where: { scheduleType: 'EXCEPTION', status: { not: 'INACTIVE' } } }),
  ]);

  // Paged, not truncated: a resolution removes a row from the queue, so the
  // page a person is on shrinks under them - clamping keeps them on the last
  // real page rather than on an empty one.
  const flaggedPageCount = Math.max(1, Math.ceil(flagged.length / FLAGGED_PAGE_SIZE));
  const flaggedSafePage = Math.min(flaggedPage, flaggedPageCount);
  const flaggedFrom = (flaggedSafePage - 1) * FLAGGED_PAGE_SIZE;
  const flaggedShown = flagged.slice(flaggedFrom, flaggedFrom + FLAGGED_PAGE_SIZE);

  const inPayroll = lines.filter((line) => line.inPayroll);
  const notInPayroll = lines.filter((line) => !line.inPayroll);
  const totalFinal = inPayroll.reduce((sum, line) => sum + line.finalPay, 0);
  const totalGross = inPayroll.reduce((sum, line) => sum + line.grossPay, 0);

  // What the queue did, still readable once nothing is pending.
  const resolvedCounts = new Map(blockStatuses.map((row) => [row.status, row._count]));
  const resolvedSummary = (() => {
    const created = resolvedCounts.get('CREATED') ?? 0;
    const mapped = resolvedCounts.get('MAPPED') ?? 0;
    const ignored = resolvedCounts.get('IGNORED') ?? 0;
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} created from the file`);
    if (mapped > 0) parts.push(`${mapped} mapped to existing people`);
    if (ignored > 0) parts.push(`${ignored} ignored`);
    return parts.length > 0 ? `${parts.join(', ')}.` : null;
  })();

  return (
    <div className="space-y-6">
      {/* header ---------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/periods" className="text-xs text-ink-soft hover:underline">
            ← All periods
          </Link>
          <h1 className="page-title mt-1">
            {periodLabel(period.year, period.month)}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            <span
              className={`pill ${locked ? 'pill-good' : 'pill-neutral'}`}
            >
              {locked ? 'Locked' : 'Draft'}
            </span>
            {period.lockedAt ? (
              // Once reopened it is a draft again, so the old approval has to
              // read as history - "Draft · Approved ..." says two things at once.
              <span className="ml-2">
                {locked ? 'Approved' : 'Previously approved'} {dateTime(period.lockedAt)}
                {period.lockedBy?.name ? ` by ${period.lockedBy.name}` : ''}
              </span>
            ) : null}
            {period.reopenCount > 0 ? (
              <span className="ml-2 text-amber-700">Reopened {period.reopenCount}×</span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="card px-4 py-2 text-right">
            <div className="text-xs text-ink-soft">Gross</div>
            <div className="tabular-nums text-sm font-semibold">{rupees(totalGross)}</div>
          </div>
          <div className="card px-4 py-2 text-right">
            <div className="text-xs text-ink-soft">Final payable</div>
            <div className="tabular-nums text-sm font-semibold">{rupees(totalFinal)}</div>
          </div>
          {!locked ? (
            <ActionForm
              action={recalculateAction}
              hidden={{ periodId: id }}
              submitLabel="Recalculate"
              pendingLabel="Calculating…"
            />
          ) : null}
        </div>
      </div>

      {/* readiness ------------------------------------------------------- */}
      {!locked ? (
        <section
          className={`alert p-5 ${
            readiness.ready ? 'alert-good' : 'alert-warn'
          }`}
        >
          <h2 className="text-sm font-semibold text-ink">
            {readiness.ready ? 'Ready for approval' : 'Finish these before approving'}
          </h2>
          {readiness.ready ? (
            <p className="mt-1 text-sm text-ink-soft">
              Every queue is clear and no flagged day is unresolved.
            </p>
          ) : (
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink-soft">
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* import ---------------------------------------------------------- */}
      {!locked ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">1 · Import the biometric export</h2>
            <span className="text-xs text-ink-soft">.xls · every sheet is parsed</span>
          </div>
          <div className="px-5 pb-5">
            <ActionForm
              action={uploadFileAction}
              hidden={{ year: String(period.year), month: String(period.month) }}
              submitLabel="Upload and import"
              pendingLabel="Reading the file and calculating…"
              variant="primary"
            >
              <div className="mb-3">
                <label className="label" htmlFor="file">
                  Monthly status report for {periodLabel(period.year, period.month)}
                </label>
                <input id="file" name="file" type="file" accept=".xls,.xlsx" className="input" required />
                <p className="mt-1 text-xs text-ink-soft">
                  Re-importing refreshes punch data and keeps every resolution already recorded.
                </p>
              </div>
            </ActionForm>
          </div>
        </section>
      ) : null}

      {/* unmatched queue -------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">2 · Unmatched punch rows</h2>
          <span className="text-xs text-ink-soft">
            {unmatched.length} pending · punch data exists but cannot be attributed
          </span>
        </div>
        {unmatched.length === 0 ? (
          // The bulk panel lives in the branch below, so a success message
          // shown inside it is destroyed by the very success it reports. What
          // the queue actually did has to be readable from the queue itself.
          <p className="px-5 py-6 text-sm text-ink-muted">
            Nothing waiting.
            {resolvedSummary ? <span className="text-ink"> {resolvedSummary}</span> : null}
          </p>
        ) : (
          <div className="divide-y divide-hairline">
            {/* Standing up a whole workforce one row at a time is not a review
                step, it is data entry - so the queue offers to do all of it at
                once, and says plainly what that costs. */}
            <div className="bg-thead p-4">
              <ActionForm
                action={createAllUnmatchedAction}
                hidden={{ periodId: period.id }}
                submitLabel={`Create all ${unmatched.length} from the file`}
                pendingLabel={`Creating ${unmatched.length} people and applying their punches…`}
                confirm={`Create ${unmatched.length} employee(s) from this file, all on the same schedule and joining date?`}
              >
                <fieldset disabled={locked}>
                  <p className="text-sm font-medium text-ink">
                    First upload? Create everyone at once
                  </p>
                  <p className="mb-3 mt-0.5 max-w-3xl text-xs text-ink-soft">
                    Takes the device ID and name from the file. The export does not carry a joining
                    date or a real schedule, so one answer is applied to everybody — good enough to
                    check the file reads, not good enough to pay from. Correct the exceptions on the
                    Employees tab before approving.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label">Schedule for everyone</label>
                      <select name="scheduleType" className="input" defaultValue="PS">
                        <option value="PS">Plant Staff — 08:00-17:00</option>
                        <option value="OS">Office Staff — 09:00-18:00</option>
                        <option value="NS">Night Shift — 22:00-06:00</option>
                        <option value="EXCEPTION">Exception — manual hours</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Joining date for everyone</label>
                      <input name="joiningDate" type="date" className="input" />
                      <p className="mt-1 text-xs text-ink-muted">
                        Optional. Only holiday pay depends on it.
                      </p>
                    </div>
                  </div>
                </fieldset>
              </ActionForm>
            </div>

            {unmatched.map((block) => (
              <div key={block.id} className="p-4">
                <p className="text-sm font-medium text-ink">
                  Device ID {block.deviceId} — {block.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {block.sheetName}, row {block.rowIndex + 1}
                </p>

                <div className="mt-3 grid gap-4 lg:grid-cols-3">
                  <ActionForm
                    action={resolveUnmatchedAction}
                    hidden={{ blockId: block.id, mode: 'MAP' }}
                    submitLabel="Map to employee"
                    className="rounded-md border border-hairline p-3"
                  >
                    <fieldset disabled={locked}>
                      <label className="label">Existing employee</label>
                      <select name="employeeId" className="input mb-2">
                        <option value="">Choose…</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name} ({employee.employeeCode})
                          </option>
                        ))}
                      </select>
                      <p className="mb-2 text-xs text-ink-soft">
                        The device ID is saved onto that record, so future months match automatically.
                      </p>
                    </fieldset>
                  </ActionForm>

                  <ActionForm
                    action={resolveUnmatchedAction}
                    hidden={{ blockId: block.id, mode: 'CREATE' }}
                    submitLabel="Create employee"
                    className="rounded-md border border-hairline p-3"
                  >
                    <fieldset disabled={locked} className="space-y-2">
                      <div>
                        <label className="label">Name</label>
                        <input name="name" className="input" defaultValue={block.name} />
                      </div>
                      <div>
                        <label className="label">Schedule</label>
                        <select name="scheduleType" className="input" defaultValue="PS">
                          <option value="OS">Office Staff — 09:00-18:00</option>
                          <option value="PS">Plant Staff — 08:00-17:00</option>
                          <option value="NS">Night Staff — 22:00-06:00</option>
                          <option value="EXCEPTION">Exception role — manual hours</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Joining date</label>
                        <input name="joiningDate" type="date" className="input" />
                      </div>
                    </fieldset>
                  </ActionForm>

                  <ActionForm
                    action={resolveUnmatchedAction}
                    hidden={{ blockId: block.id, mode: 'IGNORE' }}
                    submitLabel="Ignore this block"
                    variant="default"
                    className="rounded-md border border-hairline p-3"
                    confirm="Ignore this block for this period?"
                  >
                    <p className="mb-2 text-xs text-ink-soft">
                      Use when the row is not a real employee. The raw data is kept for audit.
                    </p>
                  </ActionForm>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* zero-punch queue ------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">3 · Zero-punch employees</h2>
          <span className="text-xs text-ink-soft">
            {zeroPunch.length} pending · known and active, but no data at all
          </span>
        </div>
        {zeroPunch.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">Nothing waiting.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {zeroPunch.map((review) => (
              <div key={review.id} className="p-4">
                <p className="text-sm font-medium text-ink">
                  {review.employee.name}
                  <span className="ml-2 text-xs font-normal text-ink-soft">
                    {review.employee.employeeCode}
                    {review.employee.deviceId ? ` · device ${review.employee.deviceId}` : ' · no device ID'}
                  </span>
                </p>
                <ActionForm
                  action={zeroPunchDecisionAction}
                  hidden={{ reviewId: review.id }}
                  submitLabel="Record decision"
                  className="mt-3"
                >
                  <fieldset disabled={locked} className="mb-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label">Decision</label>
                      <select name="decision" className="input" defaultValue="">
                        <option value="">Choose…</option>
                        <option value="KEEP_ACTIVE">Keep active (treat as flagged absences)</option>
                        <option value="EXTENDED_LEAVE">On extended leave</option>
                        <option value="LEFT_INACTIVE">Left / inactive</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Expected return (extended leave)</label>
                      <input name="expectedReturnDate" type="date" className="input" />
                    </div>
                    <div>
                      <label className="label">Note</label>
                      <input name="note" className="input" />
                    </div>
                  </fieldset>
                </ActionForm>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* exception roles --------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">4 · Exception-role hours</h2>
          <span className="text-xs text-ink-soft">
            {exceptionCount} employee(s) paid on manually entered hours
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <p className="text-sm text-ink-soft">
            Salesmen, managers, security and drivers are never paid from punch data. Enter their
            hours day by day.
          </p>
          <Link className="btn shrink-0" href={`/periods/${id}/manual-hours`}>
            Enter hours
          </Link>
        </div>
      </section>

      {/* merit ------------------------------------------------------------ */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">5 · Merit days</h2>
          <span className="text-xs text-ink-soft">₹5 per hour worked on a ticked day</span>
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <p className="text-sm text-ink-soft">
            Tick the days that earn the merit bonus. Independent of the flagged-day queue — a
            perfectly ordinary day can be ticked too.
          </p>
          <Link className="btn shrink-0" href={`/periods/${id}/merit`}>
            Tick merit days
          </Link>
        </div>
      </section>

      {/* flagged days ----------------------------------------------------- */}
      <section className="card" id="flagged">
        <div className="card-head">
          <h2 className="card-title">6 · Flagged days</h2>
          <span className="text-xs text-ink-soft">
            {flagged.length} unresolved
            {flaggedPageCount > 1
              ? ` · showing ${flaggedFrom + 1}-${flaggedFrom + flaggedShown.length}`
              : ''}
          </span>
        </div>
        {flagged.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">
            Every day either matches the standard 8 hours or has been resolved.
          </p>
        ) : (
          <>
            <div className="space-y-3 p-4">
              {flaggedShown.map((row) => (
                <FlaggedDayCard key={row.attendanceDayId} row={row} disabled={locked} />
              ))}
            </div>
            {/* A month of a full workforce runs to hundreds of these, and every
                one has to be reachable - resolving forty to see the next forty
                is not a way to work through a queue. */}
            {flaggedPageCount > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3">
                <span className="text-xs text-ink-soft">
                  Page {flaggedSafePage} of {flaggedPageCount}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {flaggedSafePage > 1 ? (
                    <Link className="btn" href={`/periods/${id}?flagged=${flaggedSafePage - 1}#flagged`}>
                      Previous
                    </Link>
                  ) : null}
                  {Array.from({ length: flaggedPageCount }, (_, index) => index + 1)
                    .filter(
                      (page) =>
                        page === 1 ||
                        page === flaggedPageCount ||
                        Math.abs(page - flaggedSafePage) <= 2,
                    )
                    .map((page, index, pages) => (
                      <span key={page} className="flex items-center gap-2">
                        {index > 0 && page - pages[index - 1] > 1 ? (
                          <span className="text-xs text-ink-muted">…</span>
                        ) : null}
                        <Link
                          className={page === flaggedSafePage ? 'btn btn-primary' : 'btn'}
                          href={`/periods/${id}?flagged=${page}#flagged`}
                          aria-current={page === flaggedSafePage ? 'page' : undefined}
                        >
                          {page}
                        </Link>
                      </span>
                    ))}
                  {flaggedSafePage < flaggedPageCount ? (
                    <Link className="btn" href={`/periods/${id}?flagged=${flaggedSafePage + 1}#flagged`}>
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* payroll ---------------------------------------------------------- */}
      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="card-title">7 · Calculated payroll</h2>
          <span className="text-xs text-ink-soft">{inPayroll.length} employees in this run</span>
        </div>
        {inPayroll.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">
            Nothing calculated yet. Import a file, then recalculate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Hours</th>
                  <th className="num">Base</th>
                  <th className="num">Punctuality</th>
                  <th className="num">Merit</th>
                  <th className="num">Holiday</th>
                  <th className="num">Extra</th>
                  <th className="num">Gross</th>
                  <th className="num">ESI</th>
                  <th className="num">PF</th>
                  <th className="num">Deductions</th>
                  <th className="num">Final</th>
                  <th className="num">Flags</th>
                </tr>
              </thead>
              <tbody>
                {inPayroll.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <span className="font-medium text-ink">{line.employee.name}</span>
                      <span className="ml-2 text-xs text-ink-muted">
                        {scheduleName(line.employee.scheduleType, line.employee.exceptionRole)}
                      </span>
                    </td>
                    <td className="num">{hours(line.payableHours)}</td>
                    <td className="num">{rupees(line.basePay)}</td>
                    <td className="num">{rupees(line.punctualityPay)}</td>
                    <td className="num">{rupees(line.meritPay)}</td>
                    <td className="num">{rupees(line.holidayPay)}</td>
                    <td className="num">{rupees(line.extraTotal)}</td>
                    <td className="num font-medium">{rupees(line.grossPay)}</td>
                    <td className="num">{rupees(line.esi)}</td>
                    <td className="num">{rupees(line.pf)}</td>
                    <td className="num">{rupees(line.deductionTotal)}</td>
                    <td className="num font-semibold text-ink">{rupees(line.finalPay)}</td>
                    <td className="num">
                      {line.daysUnresolved > 0 ? (
                        <span className="pill pill-soft-warn">{line.daysUnresolved}</span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-thead font-semibold">
                  <td>Total</td>
                  <td className="num">{hours(inPayroll.reduce((s, l) => s + l.payableHours, 0))}</td>
                  <td className="num" colSpan={6}>
                    {rupees(totalGross)} gross
                  </td>
                  <td className="num" colSpan={4}>
                    {rupees(totalFinal)} final
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* not in this payroll ---------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Not in this payroll</h2>
          <span className="text-xs text-ink-soft">{notInPayroll.length} excluded</span>
        </div>
        {notInPayroll.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">Nobody is excluded from this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {notInPayroll.map((line) => (
                  <tr key={line.id}>
                    <td className="font-medium text-ink">{line.employee.name}</td>
                    <td>
                      {line.exclusionReason === 'LEFT_INACTIVE' ? 'Left / inactive' : 'On extended leave'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* approval --------------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">8 · Approval</h2>
          <span className="text-xs text-ink-soft">Admin only</span>
        </div>
        <div className="px-5 pb-5">
          {!admin ? (
            <p className="text-sm text-ink-soft">
              Only the Admin can approve, lock or reopen a payroll period.
            </p>
          ) : locked ? (
            <ActionForm
              action={reopenPeriodAction}
              hidden={{ periodId: id }}
              submitLabel="Reopen for correction"
              variant="danger"
              confirm="Reopen this locked period? Every subsequent change is recorded in the audit trail."
            >
              <div className="mb-3 max-w-lg">
                <label className="label">Reason for reopening</label>
                <input name="reason" className="input" required placeholder="What needs correcting?" />
              </div>
            </ActionForm>
          ) : (
            <ActionForm
              action={lockPeriodAction}
              hidden={{ periodId: id }}
              submitLabel="Approve and lock"
              variant="primary"
              confirm="Approve and lock this period?"
            >
              <div className="mb-3 max-w-lg space-y-2">
                {!readiness.ready ? (
                  <>
                    <label className="flex items-center gap-2 text-sm text-ink-soft">
                      <input type="checkbox" name="force" />
                      Lock despite the outstanding items listed above
                    </label>
                    <div>
                      <label className="label">Note (required when overriding)</label>
                      <input name="note" className="input" placeholder="Why is it acceptable to lock now?" />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="label">Note (optional)</label>
                    <input name="note" className="input" />
                  </div>
                )}
              </div>
            </ActionForm>
          )}
        </div>
      </section>

      {/* exports ----------------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">9 · Payslips and reports</h2>
          <span className="text-xs text-ink-soft">
            {period.status === 'LOCKED' ? 'Approved figures' : 'Draft figures — not yet approved'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <a className="btn" href={`/api/periods/${id}/report`}>
            Summary report (.xlsx)
          </a>
          <a className="btn" href={`/api/periods/${id}/payslips`}>
            All payslips (.pdf)
          </a>
          <span className="text-xs text-ink-soft">
            {inPayroll.length} payslip(s) · one page each
          </span>
        </div>
      </section>

      {/* audit ------------------------------------------------------------ */}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Audit trail</h2>
          <span className="text-xs text-ink-soft">most recent 20</span>
        </div>
        {auditLogs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">Nothing recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Field</th>
                  <th>Old → new</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap text-xs">{dateTime(log.at)}</td>
                    <td className="text-xs">{log.user?.name ?? 'system'}</td>
                    <td className="text-xs">{log.action}</td>
                    <td className="text-xs">{log.field ?? '—'}</td>
                    <td className="max-w-md truncate text-xs text-ink-soft" title={log.note ?? ''}>
                      {log.oldValue || log.newValue
                        ? `${log.oldValue ?? '—'} → ${log.newValue ?? '—'}`
                        : (log.note ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* delete ----------------------------------------------------------- */}
      {admin ? (
        <section className="card border-red-200">
          <div className="card-head">
            <h2 className="card-title">Delete this month&apos;s payroll</h2>
            <span className="text-xs text-ink-soft">Admin only · cannot be undone</span>
          </div>
          <div className="px-5 pb-5">
            {locked ? (
              <p className="text-sm text-ink-soft">
                This month is approved and locked. Reopen it above before it can be deleted.
              </p>
            ) : (
              <ActionForm
                action={deletePeriodAction}
                hidden={{ periodId: id }}
                submitLabel={`Delete ${periodLabel(period.year, period.month)}`}
                pendingLabel="Deleting…"
                variant="danger"
                confirm={`Permanently delete the ${periodLabel(period.year, period.month)} payroll? This cannot be undone.`}
              >
                <p className="mb-3 max-w-2xl text-sm text-ink-soft">
                  Removes the imported attendance, both review queues, flagged-day decisions, bonuses,
                  one-off deductions, the calculated payroll ({lines.length} line(s)) and this
                  month&apos;s audit trail. Employees, their hourly rates and monthly salaries, and
                  recurring deductions are kept, so the month can be started again from a fresh
                  upload.
                </p>
                <div className="mb-3 max-w-xs">
                  <label className="label" htmlFor="confirmLabel">
                    Type <strong>{periodLabel(period.year, period.month)}</strong> to confirm
                  </label>
                  <input id="confirmLabel" name="confirmLabel" className="input" autoComplete="off" required />
                </div>
              </ActionForm>
            )}
          </div>
        </section>
      ) : null}

      <p className="pb-8 text-xs text-ink-muted">
        Period {periodLabel(period.year, period.month)} · created {shortDate(period.createdAt)}
      </p>
    </div>
  );
}
