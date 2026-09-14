'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { CHART, MARKS, niceAxis, seriesColor } from './tokens';
import { INTEGER_FORMATS, formatter, type ValueFormat } from './format';
import { useContainerWidth } from './useContainerWidth';

export interface LineSeries {
  /** Stable key - colour follows the entity, so never reorder to re-colour. */
  key: string;
  label: string;
  /** One value per x position; null leaves a gap rather than inventing a point. */
  values: (number | null)[];
}

export interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  /** Named format - a function cannot cross the server/client boundary. */
  format?: ValueFormat;
  /** Axis-tick format; falls back to `format`. */
  formatTick?: ValueFormat;
  height?: number;
  /** Draws a 10% wash under a single series. */
  fillArea?: boolean;
  /** Fixes the y-axis top, e.g. 100 for a percentage. */
  maxOverride?: number;
  caption?: string;
}

const PAD = { top: 16, right: 76, bottom: 28, left: 52 };

/**
 * Time-series line chart with a crosshair readout and a table view.
 *
 * One y-axis only, always. Two measures of different scale belong in two
 * charts, never on a second axis.
 */
export function LineChart({
  labels,
  series,
  format: formatKind = 'compact',
  formatTick: tickKind,
  height = 220,
  fillArea = false,
  maxOverride,
  caption,
}: LineChartProps) {
  const format = formatter(formatKind);
  const formatTick = formatter(tickKind ?? formatKind);

  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerRef, width] = useContainerWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;

  const axis = useMemo(() => {
    const values = series.flatMap((s) => s.values.filter((v): v is number => v != null));
    const peak = maxOverride ?? Math.max(1, ...values);
    return niceAxis(peak, 4, { integer: INTEGER_FORMATS.includes(tickKind ?? formatKind) });
  }, [series, maxOverride, tickKind, formatKind]);

  const max = maxOverride ?? axis.max;
  const ticks = maxOverride != null ? niceAxis(maxOverride, 4).ticks : axis.ticks;
  const step = labels.length > 1 ? plotWidth / (labels.length - 1) : 0;

  const x = (index: number) => PAD.left + (labels.length > 1 ? index * step : plotWidth / 2);
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;

  /** Break the path at nulls so a gap reads as missing, not as a straight line. */
  const pathFor = (values: (number | null)[]) => {
    let path = '';
    let penDown = false;
    values.forEach((value, index) => {
      if (value == null) {
        penDown = false;
        return;
      }
      path += `${penDown ? 'L' : 'M'}${x(index).toFixed(2)} ${y(value).toFixed(2)} `;
      penDown = true;
    });
    return path.trim();
  };

  const lastDefined = (values: (number | null)[]) => {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (values[index] != null) return index;
    }
    return -1;
  };

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || labels.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const position = ratio * width;
    const index = Math.round((position - PAD.left) / (step || 1));
    setHoverIndex(Math.max(0, Math.min(labels.length - 1, index)));
  };

  // Sparse tick labels so they never collide on a narrow chart.
  const labelStride = Math.max(1, Math.ceil(labels.length / 7));

  /**
   * Direct end-labels only work while the series separate at the right edge.
   * When they converge, nudging labels apart detaches them from their lines, so
   * drop them entirely and let the legend and tooltip carry identity instead.
   */
  const endLabelsFit = useMemo(() => {
    const ends = series
      .map((entry) => {
        const index = lastDefined(entry.values);
        return index >= 0 ? y(entry.values[index]!) : null;
      })
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b);

    for (let i = 1; i < ends.length; i += 1) {
      if (ends[i] - ends[i - 1] < 12) return false;
    }
    return true;
  }, [series, max]);

  if (labels.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-ink-soft">No periods to chart yet.</p>;
  }

  return (
    <div>
      <div className="relative" ref={containerRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          className="touch-none"
          role="img"
          aria-label={caption ?? 'Trend chart'}
          onPointerMove={handlePointer}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {fillArea && series.length === 1 ? (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(0)} stopOpacity={MARKS.areaOpacity} />
                <stop offset="100%" stopColor={seriesColor(0)} stopOpacity={0} />
              </linearGradient>
            </defs>
          ) : null}

          {/* gridlines: solid hairlines, one step off the surface */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? CHART.axis : CHART.gridline}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(tick) + 3}
                textAnchor="end"
                fontSize={10}
                fill={CHART.inkMuted}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {/* x labels */}
          {labels.map((label, index) =>
            index % labelStride === 0 || index === labels.length - 1 ? (
              <text
                key={label + index}
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fill={CHART.inkMuted}
              >
                {label}
              </text>
            ) : null,
          )}

          {/* crosshair finds the x; the reader aims at a period, not a line */}
          {hoverIndex != null ? (
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
              stroke={CHART.axis}
              strokeWidth={1}
            />
          ) : null}

          {series.map((entry, seriesIndex) => {
            const colour = seriesColor(seriesIndex);
            const endIndex = lastDefined(entry.values);
            const endValue = endIndex >= 0 ? entry.values[endIndex] : null;

            return (
              <g key={entry.key}>
                {fillArea && series.length === 1 && endIndex >= 0 ? (
                  <path
                    d={`${pathFor(entry.values)} L${x(endIndex)} ${y(0)} L${x(0)} ${y(0)} Z`}
                    fill={`url(#${gradientId})`}
                  />
                ) : null}

                <path
                  d={pathFor(entry.values)}
                  fill="none"
                  stroke={colour}
                  strokeWidth={MARKS.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* end marker with a surface ring, so overlaps stay legible */}
                {endValue != null ? (
                  <circle
                    cx={x(endIndex)}
                    cy={y(endValue)}
                    r={MARKS.markerRadius}
                    fill={colour}
                    stroke={CHART.surface}
                    strokeWidth={MARKS.surfaceRing}
                  />
                ) : null}

                {/* direct end label - selective, never a number on every point */}
                {endValue != null && endLabelsFit ? (
                  <text
                    x={x(endIndex) + 10}
                    y={y(endValue) + 3}
                    fontSize={10}
                    fill={CHART.inkSecondary}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {format(endValue)}
                  </text>
                ) : null}

                {hoverIndex != null && entry.values[hoverIndex] != null ? (
                  <circle
                    cx={x(hoverIndex)}
                    cy={y(entry.values[hoverIndex]!)}
                    r={MARKS.markerRadius}
                    fill={colour}
                    stroke={CHART.surface}
                    strokeWidth={MARKS.surfaceRing}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {hoverIndex != null ? (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-hairline bg-white px-2.5 py-2 text-xs shadow-sm"
            style={{
              left: `${Math.min(78, ((PAD.left + hoverIndex * step) / width) * 100)}%`,
            }}
          >
            <div className="mb-1 font-medium text-ink-soft">{labels[hoverIndex]}</div>
            {series.map((entry, seriesIndex) => (
              <div key={entry.key} className="flex items-center gap-2 whitespace-nowrap">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                  style={{ background: seriesColor(seriesIndex) }}
                />
                <span className="font-semibold tabular-nums text-ink">
                  {entry.values[hoverIndex] == null ? '—' : format(entry.values[hoverIndex]!)}
                </span>
                <span className="text-ink-soft">{entry.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {/* legend is always present for two or more series */}
        {series.length > 1 ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {series.map((entry, seriesIndex) => (
              <span key={entry.key} className="flex items-center gap-1.5 text-xs text-ink-soft">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-3.5 rounded-full"
                  style={{ background: seriesColor(seriesIndex) }}
                />
                {entry.label}
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}

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
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={label + index}>
                  <td>{label}</td>
                  {series.map((entry) => (
                    <td key={entry.key} className="num">
                      {entry.values[index] == null ? '—' : format(entry.values[index]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
