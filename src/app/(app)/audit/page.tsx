import Link from 'next/link';
import { db } from '@/lib/db';
import { dateTime, periodLabel } from '@/lib/format';
import {
  ACTION_LABELS,
  actionLabel,
  actorLabel,
  auditValue,
  entityLabel,
  SIGNIFICANT_ACTIONS,
} from '@/lib/auditFormat';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; action?: string; page?: string; routine?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  // Recalculations happen on nearly every edit and swamp the log, so they are
  // hidden unless asked for. Everything is still on record.
  const showRoutine = params.routine === 'yes';
  const where = {
    ...(params.period && params.period !== 'all' ? { periodId: params.period } : {}),
    ...(params.action && params.action !== 'all'
      ? { action: params.action }
      : showRoutine
        ? {}
        : { action: { not: 'PERIOD_RECALCULATE' } }),
  };

  const [logs, total, periods] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: {
        user: { select: { name: true } },
        period: { select: { year: true, month: true } },
      },
      orderBy: { at: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.payrollPeriod.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const linkFor = (nextPage: number) => {
    const query = new URLSearchParams();
    if (params.period && params.period !== 'all') query.set('period', params.period);
    if (params.action && params.action !== 'all') query.set('action', params.action);
    if (showRoutine) query.set('routine', 'yes');
    query.set('page', String(nextPage));
    return `/audit?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Audit trail</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Every recorded change: who, when, and old value to new value. Field-level entries are
          written for changes made while a period is reopened, and the lock, reopen and import
          actions are always logged.
        </p>
      </div>

      {/* one filter row, above the content it scopes */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label className="label" htmlFor="period">
            Period
          </label>
          <select id="period" name="period" className="input" defaultValue={params.period ?? 'all'}>
            <option value="all">All periods</option>
            {periods.map((option) => (
              <option key={option.id} value={option.id}>
                {periodLabel(option.year, option.month)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-56">
          <label className="label" htmlFor="action">
            Action
          </label>
          <select id="action" name="action" className="input" defaultValue={params.action ?? 'all'}>
            <option value="all">All actions</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-soft">
          <input type="checkbox" name="routine" value="yes" defaultChecked={showRoutine} />
          Include routine recalculations
        </label>
        <button type="submit" className="btn mb-0.5">
          Apply
        </button>
      </form>

      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="card-title">Entries</h2>
          <span className="text-xs text-ink-soft">
            {total} entr{total === 1 ? 'y' : 'ies'} · page {page} of {pageCount}
            {showRoutine ? '' : ' · routine recalculations hidden'}
          </span>
        </div>

        {logs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">Nothing matches that filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Period</th>
                  <th>Entity</th>
                  <th>Field</th>
                  <th>Old → new</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-sm text-ink-muted">
                      Nothing recorded yet. Every rate change, import, resolution and approval
                      lands here as it happens.
                    </td>
                  </tr>
                ) : null}
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap text-xs">{dateTime(log.at)}</td>
                    <td className="text-xs">{actorLabel(log.user?.name)}</td>
                    <td className="text-xs">
                      <span
                        className={`pill ${
                          SIGNIFICANT_ACTIONS.has(log.action) ? 'pill-soft-warn' : 'pill-neutral'
                        }`}
                      >
                        {actionLabel(log.action)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {log.period ? (
                        <Link className="hover:underline" href={`/periods/${log.periodId}`}>
                          {periodLabel(log.period.year, log.period.month)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-xs text-ink-soft">{entityLabel(log.entityType)}</td>
                    <td className="text-xs">{log.field ?? '—'}</td>
                    <td
                      className="max-w-sm truncate text-xs text-ink-soft"
                      title={`${auditValue(log.oldValue)} → ${auditValue(log.newValue)}`}
                    >
                      {log.oldValue || log.newValue ? (
                        log.oldValue ? (
                          <>
                            <span className="text-ink-muted">{auditValue(log.oldValue)}</span>
                            {' → '}
                            <span className="text-ink">{auditValue(log.newValue)}</span>
                          </>
                        ) : (
                          <span className="text-ink">{auditValue(log.newValue)}</span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-xs truncate text-xs text-ink-soft" title={log.note ?? ''}>
                      {log.note ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
            {page > 1 ? (
              <Link className="btn" href={linkFor(page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            {page < pageCount ? (
              <Link className="btn" href={linkFor(page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
