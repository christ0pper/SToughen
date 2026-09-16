'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface DirectoryRow {
  id: string;
  name: string;
  employeeCode: string;
  deviceId: string | null;
  scheduleName: string;
  scheduleHours: string;
  joined: string | null;
  pay: string | null;
  statutory: string;
  status: string;
  statusLabel: string;
  statusStyle: string;
}

/**
 * The directory table, with a filter over it.
 *
 * Everything is already on the page - the filter narrows what is drawn rather
 * than asking the server again, which is the right trade at this size (a few
 * hundred people at most) and keeps it instant. Finding one person in sixty by
 * scrolling was the alternative.
 */
export function EmployeeDirectory({ rows }: { rows: DirectoryRow[] }) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.employeeCode, row.deviceId ?? '', row.scheduleName, row.statusLabel]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, query]);

  return (
    <section className="card overflow-hidden">
      <div className="card-head flex-wrap gap-3">
        <h2 className="card-title">Directory</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="card-note">open anyone to see their full record</span>
          <input
            type="search"
            className="input w-56"
            placeholder="Find by name, code or device ID"
            aria-label="Filter the directory"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {query.trim() ? (
        <p className="border-b border-hairline px-5 py-2 text-xs text-ink-soft">
          {shown.length} of {rows.length} shown
          <button type="button" className="ml-2 underline hover:text-ink" onClick={() => setQuery('')}>
            clear
          </button>
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Device ID</th>
              <th>Schedule</th>
              <th>Joined</th>
              <th className="num">Current pay</th>
              <th>ESI / PF</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center">
                  <p className="text-sm font-medium text-ink">Nobody on record yet</p>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-soft">
                    Add your staff here with the Device ID the biometric machine knows them by.
                    Anyone the first export finds who is not on this list lands in the unmatched
                    queue instead, where you can create them from the punch data.
                  </p>
                </td>
              </tr>
            ) : null}
            {rows.length > 0 && shown.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center text-sm text-ink-soft">
                  Nobody matches “{query.trim()}”.
                </td>
              </tr>
            ) : null}
            {shown.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link
                    className="font-medium text-ink hover:text-brand hover:underline"
                    href={`/employees/${row.id}`}
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="text-xs text-ink-muted">{row.employeeCode}</td>
                <td className="tabular-nums">
                  {row.deviceId ?? <span className="text-amber-600">not linked</span>}
                </td>
                <td>
                  <span className="block">{row.scheduleName}</span>
                  <span className="text-xs text-ink-muted">{row.scheduleHours}</span>
                </td>
                <td className="text-xs">
                  {row.joined ?? <span className="text-warn-ink">not set</span>}
                </td>
                <td className="num">
                  {row.pay ?? <span className="text-amber-600">not set</span>}
                </td>
                <td className="text-xs">{row.statutory}</td>
                <td>
                  <span className={`pill ${row.statusStyle}`}>{row.statusLabel}</span>
                </td>
                <td className="text-right">
                  <Link className="btn" href={`/employees/${row.id}`}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
