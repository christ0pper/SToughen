'use client';

import { useState } from 'react';

export interface PagedTableProps {
  /** The <tr> of <th> for the table head. */
  head: React.ReactNode;
  /** One <tr> per row, already rendered on the server. */
  rows: React.ReactNode[];
  columns: number;
  empty: string;
  pageSize?: number;
}

const SIZES = [10, 25, 50];

/**
 * A table with the source design's pager underneath.
 *
 * Every row is already in the payload - these tables are one employee's history,
 * not an unbounded feed - so paging is a slice, not a fetch. Changing the page
 * size keeps you on the row you were looking at rather than snapping to page 1.
 */
export function PagedTable({ head, rows, columns, empty, pageSize = 10 }: PagedTableProps) {
  const [size, setSize] = useState(pageSize);
  const [page, setPage] = useState(1);

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const visible = rows.slice(start, start + size);

  const goto = (next: number) => setPage(Math.max(1, Math.min(pages, next)));

  const resize = (next: number) => {
    // Keep the first visible row visible, so the view does not jump.
    setPage(Math.floor(start / next) + 1);
    setSize(next);
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>{head}</thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns} className="py-6 text-center text-sm text-ink-muted">
                  {empty}
                </td>
              </tr>
            ) : (
              visible
            )}
          </tbody>
        </table>
      </div>

      {rows.length > SIZES[0] ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-5 py-3 text-xs text-ink-soft">
          <button
            type="button"
            className="btn px-2 py-1"
            onClick={() => goto(current - 1)}
            disabled={current === 1}
            aria-label="Previous page"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                 strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="btn px-2.5 py-1"
            onClick={() => goto(current - 1)}
            disabled={current === 1}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn btn-accent px-2.5 py-1"
            onClick={() => goto(current + 1)}
            disabled={current === pages}
          >
            Next
          </button>
          <span className="ml-2">
            Page {current} of <span className="font-medium text-brand">{pages}</span>
          </span>
          <select
            className="input ml-1 w-auto py-1"
            value={size}
            onChange={(event) => resize(Number(event.target.value))}
            aria-label="Rows per page"
          >
            {SIZES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}
