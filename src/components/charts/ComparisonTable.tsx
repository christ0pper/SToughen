'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MagnitudeBar } from './StatTile';
import { formatValue } from './format';
import { scheduleName } from '@/lib/format';
import type { EmployeeComparisonRow } from '@/services/analyticsService';

type SortKey =
  | 'name'
  | 'payableHours'
  | 'daysPresent'
  | 'daysAbsent'
  | 'leaveDays'
  | 'punctualityRate'
  | 'meritDays'
  | 'deductionTotal'
  | 'finalPay';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Employee', numeric: false },
  { key: 'payableHours', label: 'Hours', numeric: true },
  { key: 'daysPresent', label: 'Days worked', numeric: true },
  { key: 'daysAbsent', label: 'Days absent', numeric: true },
  { key: 'leaveDays', label: 'Leave days', numeric: true },
  { key: 'punctualityRate', label: 'Punctuality', numeric: true },
  { key: 'meritDays', label: 'Merit days', numeric: true },
  { key: 'deductionTotal', label: 'Deductions', numeric: true },
  { key: 'finalPay', label: 'Final pay', numeric: true },
];

export interface ComparisonTableProps {
  rows: EmployeeComparisonRow[];
}

/**
 * Cross-employee comparison. A table rather than a chart: past roughly seven
 * classes that all carry meaning, colour stops distinguishing anything, and a
 * hundred employees is far past that. The one magnitude cue is a single-hue bar
 * on punctuality, the metric the comparison is usually about.
 */
export function ComparisonTable({ rows }: ComparisonTableProps) {
  const money = (value: number) => formatValue('rupees', value);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [descending, setDescending] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      const left = a[sortKey] ?? -1;
      const right = b[sortKey] ?? -1;
      return Number(left) - Number(right);
    });
    return descending ? copy.reverse() : copy;
  }, [rows, sortKey, descending]);

  const maxPunctuality = Math.max(100, ...rows.map((row) => row.punctualityRate ?? 0));

  const toggle = (key: SortKey) => {
    if (key === sortKey) setDescending((value) => !value);
    else {
      setSortKey(key);
      setDescending(key !== 'name');
    }
  };

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-soft">
        No calculated payroll yet. Import a period to populate this.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} className={column.numeric ? 'num' : undefined}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-ink"
                  onClick={() => toggle(column.key)}
                  aria-sort={
                    sortKey === column.key ? (descending ? 'descending' : 'ascending') : 'none'
                  }
                >
                  {column.label}
                  <span aria-hidden className="text-[10px]">
                    {sortKey === column.key ? (descending ? '▼' : '▲') : '·'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.employeeId}>
              <td>
                <Link href={`/employees/${row.employeeId}`} className="font-medium text-ink hover:underline">
                  {row.name}
                </Link>
                <span className="ml-2 text-xs text-ink-soft">
                  {scheduleName(row.scheduleType, row.exceptionRole)}
                </span>
              </td>
              <td className="num">{row.payableHours.toFixed(2)}</td>
              <td className="num">{row.daysPresent}</td>
              <td className="num">{row.daysAbsent}</td>
              <td className="num">{row.leaveDays}</td>
              <td className="num">
                {row.punctualityRate == null ? (
                  <span className="text-ink-muted">—</span>
                ) : (
                  <MagnitudeBar
                    value={row.punctualityRate}
                    max={maxPunctuality}
                    label={`${row.punctualityRate.toFixed(0)}%`}
                  />
                )}
              </td>
              <td className="num">{row.meritDays}</td>
              <td className="num">{money(row.deductionTotal)}</td>
              <td className="num font-medium">{money(row.finalPay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
