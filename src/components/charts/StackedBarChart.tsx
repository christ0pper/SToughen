'use client';

import { useMemo, useState } from 'react';
import { CHART, MARKS, niceAxis, seriesColor } from './tokens';
import { INTEGER_FORMATS, formatter, type ValueFormat } from './format';
import { useContainerWidth } from './useContainerWidth';

export interface StackSeries {
  key: string;
  label: string;
  values: number[];
  /**
   * Overrides the categorical slot. Used for a residual "Other" bucket, which
   * takes the de-emphasis grey rather than burning a categorical hue - the
   * palette validates three slots on this surface, and a fourth would need
   * re-running the validator.
   */
  color?: string;
}

export interface StackedBarChartProps {
  labels: string[];
  series: StackSeries[];
  /** Named format - a function cannot cross the server/client boundary. */
  format?: ValueFormat;
  /** Axis-tick format; falls back to `format`. Use a compact one for money. */
  formatTick?: ValueFormat;
  height?: number;
  caption?: string;
}

const PAD = { top: 16, right: 12, bottom: 28, left: 44 };

/** Part-to-whole over time. One y-axis; segments separated by a surface gap. */
export function StackedBarChart({
  labels,
  series,
  format: formatKind = 'integer',
  formatTick: tickKind,
  height = 200,
  caption,
}: StackedBarChartProps) {
  const format = formatter(formatKind);
  const formatTick = formatter(tickKind ?? formatKind);
  const [containerRef, width] = useContainerWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;

  const totals = useMemo(
    () => labels.map((_, index) => series.reduce((sum, s) => sum + (s.values[index] ?? 0), 0)),
    [labels, series],
  );

  const { max, ticks } = niceAxis(Math.max(1, ...totals), 4, {
    integer: INTEGER_FORMATS.includes(tickKind ?? formatKind),
  });

  const band = labels.length > 0 ? plotWidth / labels.length : plotWidth;
  const barWidth = Math.min(MARKS.maxBarThickness, band * 0.6);
  const centre = (index: number) => PAD.left + band * index + band / 2;
  const scale = (value: number) => (value / max) * plotHeight;

  const colourFor = (entry: StackSeries, index: number) => entry.color ?? seriesColor(index);

  if (labels.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-ink-soft">Nothing to chart yet.</p>;
  }

  const labelStride = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div>
      <div className="relative" ref={containerRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={caption ?? 'Stacked breakdown'}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotWidth}
                y1={PAD.top + plotHeight - scale(tick)}
                y2={PAD.top + plotHeight - scale(tick)}
                stroke={tick === 0 ? CHART.axis : CHART.gridline}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={PAD.top + plotHeight - scale(tick) + 3}
                textAnchor="end"
                fontSize={10}
                fill={CHART.inkMuted}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {labels.map((label, index) => {
            let cursor = 0;
            const segments = series.map((entry, seriesIndex) => {
              const value = entry.values[index] ?? 0;
              const rawHeight = scale(value);
              const bottom = PAD.top + plotHeight - scale(cursor);
              cursor += value;
              return { entry, seriesIndex, value, rawHeight, bottom };
            });

            const drawn = segments.filter((segment) => segment.value > 0);

            return (
              <g
                key={label + index}
                onPointerEnter={() => setHoverIndex(index)}
                onFocus={() => setHoverIndex(index)}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${label}: ${format(totals[index])}`}
                style={{ outline: 'none' }}
              >
                {/* hit target wider than the mark */}
                <rect
                  x={PAD.left + band * index}
                  y={PAD.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                />

                {drawn.map((segment, drawnIndex) => {
                  const isTop = drawnIndex === drawn.length - 1;
                  // A 2px surface gap separates touching segments - never a stroke.
                  const gap = drawnIndex === 0 ? 0 : MARKS.surfaceGap;
                  const barHeight = Math.max(1, segment.rawHeight - gap);
                  return (
                    <rect
                      key={segment.entry.key}
                      x={centre(index) - barWidth / 2}
                      y={segment.bottom - segment.rawHeight}
                      width={barWidth}
                      height={barHeight}
                      rx={isTop ? MARKS.barRadius : 0}
                      fill={colourFor(segment.entry, segment.seriesIndex)}
                      opacity={hoverIndex == null || hoverIndex === index ? 1 : 0.55}
                    />
                  );
                })}
              </g>
            );
          })}

          {labels.map((label, index) =>
            index % labelStride === 0 || index === labels.length - 1 ? (
              <text
                key={label + index}
                x={centre(index)}
                y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fill={CHART.inkMuted}
              >
                {label}
              </text>
            ) : null,
          )}
        </svg>

        {hoverIndex != null ? (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-hairline bg-white px-2.5 py-2 text-xs shadow-sm"
            style={{ left: `${Math.min(74, ((centre(hoverIndex) - 40) / width) * 100)}%` }}
          >
            <div className="mb-1 font-medium text-ink-soft">{labels[hoverIndex]}</div>
            {series.map((entry, seriesIndex) => (
              <div key={entry.key} className="flex items-center gap-2 whitespace-nowrap">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: colourFor(entry, seriesIndex) }}
                />
                <span className="font-semibold tabular-nums text-ink">
                  {format(entry.values[hoverIndex] ?? 0)}
                </span>
                <span className="text-ink-soft">{entry.label}</span>
              </div>
            ))}
            <div className="mt-1 border-t border-hairline pt-1 font-semibold tabular-nums text-ink">
              {format(totals[hoverIndex])} total
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {series.map((entry, seriesIndex) => (
            <span key={entry.key} className="flex items-center gap-1.5 text-xs text-ink-soft">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: colourFor(entry, seriesIndex) }}
              />
              {entry.label}
            </span>
          ))}
        </div>

        <button
          type="button"
          className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
          onClick={() => setShowTable((open) => !open)}
          aria-expanded={showTable}
        >
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </div>

      {showTable ? (
        <div className="mt-2 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                {series.map((entry) => (
                  <th key={entry.key} className="num">
                    {entry.label}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={label + index}>
                  <td>{label}</td>
                  {series.map((entry) => (
                    <td key={entry.key} className="num">
                      {format(entry.values[index] ?? 0)}
                    </td>
                  ))}
                  <td className="num font-medium">{format(totals[index])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
