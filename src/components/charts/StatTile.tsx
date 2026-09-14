import { CHART, MARKS, seriesColor } from './tokens';
import { TrendDownIcon, TrendUpIcon } from '../Icons';

export interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
}

/**
 * A 12-point trend in the de-emphasis grey with the current period accented -
 * context, not a chart. No axis, labels or hover: the tile's value is the
 * reading, and the full series lives in the charts below.
 */
export function Sparkline({ values, width = 84, height = 26 }: SparklineProps) {
  const points = values.slice(-12);
  const numbers = points.filter((value): value is number => value != null);
  if (numbers.length < 2) return null;

  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min || 1;
  const step = points.length > 1 ? (width - 6) / (points.length - 1) : 0;

  const x = (index: number) => 3 + index * step;
  const y = (value: number) => height - 3 - ((value - min) / span) * (height - 6);

  let path = '';
  let penDown = false;
  points.forEach((value, index) => {
    if (value == null) {
      penDown = false;
      return;
    }
    path += `${penDown ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)} `;
    penDown = true;
  });

  let lastIndex = -1;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index] != null) {
      lastIndex = index;
      break;
    }
  }
  const lastValue = lastIndex >= 0 ? points[lastIndex] : null;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
      <path
        d={path.trim()}
        fill="none"
        stroke={CHART.deEmphasis}
        strokeWidth={MARKS.lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {lastValue != null ? (
        <circle
          cx={x(lastIndex)}
          cy={y(lastValue)}
          r={3}
          fill={seriesColor(0)}
          stroke={CHART.surface}
          strokeWidth={MARKS.surfaceRing}
        />
      ) : null}
    </svg>
  );
}

export interface StatTileProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  /**
   * Signed change against the previous period. `upIsGood: null` colours it
   * neutrally - payroll cost rising is neither good nor bad, and painting it
   * red would assert a judgement the data does not support.
   */
  delta?: { value: number; format: (value: number) => string; upIsGood: boolean | null } | null;
  deltaCaption?: string;
  trend?: (number | null)[];
  /** Renders the value at hero size. Exactly one per view. */
  hero?: boolean;
  note?: string;
}

const GOOD = 'text-emerald-600';
const BAD = 'text-rose-500';
const NEUTRAL = 'text-ink-soft';

export function StatTile({
  label,
  value,
  icon,
  delta,
  deltaCaption,
  trend,
  hero = false,
  note,
}: StatTileProps) {
  const direction = delta == null || delta.value === 0 ? 0 : delta.value > 0 ? 1 : -1;
  const judged = delta?.upIsGood ?? null;
  const toneClass =
    direction === 0 || judged == null ? NEUTRAL : direction > 0 === judged ? GOOD : BAD;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5">
        {icon ? <span className="stat-icon bg-well text-ink-soft">{icon}</span> : null}
        <span className="stat-label">{label}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div
          className={`font-bold leading-none tracking-tight text-ink ${
            hero ? 'text-[32px]' : 'text-2xl'
          }`}
        >
          {value}
        </div>
        {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
      </div>

      {delta != null && direction !== 0 ? (
        <div className={`mt-2.5 flex items-center gap-1 text-xs ${toneClass}`}>
          {direction > 0 ? <TrendUpIcon /> : <TrendDownIcon />}
          <span className="font-medium tabular-nums">
            {direction > 0 ? '+' : '−'}
            {delta.format(Math.abs(delta.value))}
          </span>
          <span className="text-ink-muted">{deltaCaption ?? 'vs previous period'}</span>
        </div>
      ) : note ? (
        <div className="mt-2.5 text-xs text-ink-muted">{note}</div>
      ) : null}
    </div>
  );
}

export interface MagnitudeBarProps {
  value: number;
  max: number;
  label: string;
}

/**
 * An in-row magnitude bar. One hue for every row: employees have no natural
 * order, so a value-ramp would double-encode length as hue.
 */
export function MagnitudeBar({ value, max, label }: MagnitudeBarProps) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular-nums">{label}</span>
      <span aria-hidden className="h-1.5 w-16 shrink-0 rounded-full bg-well">
        <span
          className="block h-full rounded-full"
          style={{ width: `${share * 100}%`, background: seriesColor(0) }}
        />
      </span>
    </div>
  );
}
