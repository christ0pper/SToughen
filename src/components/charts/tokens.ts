/**
 * Chart palette and chrome.
 *
 * Blue-led to match the app's brand. Verified with the dataviz validator
 * against this app's chart surface (white cards):
 *
 *   node scripts/validate_palette.js "#2563eb,#eb6834,#1baf7a"  *        --mode light --surface "#ffffff" --pairs all
 *   lightness band PASS · chroma floor PASS · CVD separation PASS (worst dE 9.2)
 *   normal-vision floor PASS (worst dE 27.6) · contrast WARN on teal (2.82:1)
 *
 * The teal contrast warning is an obligation, not a licence: every chart
 * using it ships a legend and a table view, so no value is reachable by colour
 * alone. Do not add a fourth slot without re-running the validator.
 *
 * Chrome tones are the app's own slate scale, so charts sit consistently inside
 * the rest of the UI. Only the series hues carry meaning.
 */
export const SERIES = ['#2563eb', '#eb6834', '#1baf7a'] as const;

export type SeriesColor = (typeof SERIES)[number];

export const CHART = {
  /** The card background charts are drawn on - also the gap and ring colour. */
  surface: '#ffffff',
  /** Unfilled track on a gauge or meter: a light step of the brand hue. */
  track: '#eff4ff',
  gridline: '#eef1f5',
  axis: '#dde3ea',
  inkPrimary: '#0f172a',
  inkSecondary: '#475569',
  inkMuted: '#7c8798',
  /** Context marks in an emphasis chart. */
  deEmphasis: '#d7dde5',
} as const;

/** Fixed mark specs from the dataviz method. Do not tune per chart. */
export const MARKS = {
  lineWidth: 2,
  markerRadius: 4,
  surfaceRing: 2,
  surfaceGap: 2,
  maxBarThickness: 24,
  barRadius: 4,
  areaOpacity: 0.1,
} as const;

/** Colour follows the entity, never its rank - look series up by fixed index. */
export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

/** Drops trailing zeros, so an axis reads 25K / 1L rather than 25.0K / 1.00L. */
const trim = (value: number, digits: number) => Number(value.toFixed(digits)).toString();

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${trim(value / 1_00_00_000, 2)}Cr`;
  if (abs >= 1_00_000) return `${trim(value / 1_00_000, 2)}L`;
  if (abs >= 1_000) return `${trim(value / 1_000, 1)}K`;
  return trim(value, 2);
}

export interface Axis {
  max: number;
  ticks: number[];
}

/**
 * An axis whose ticks are round numbers.
 *
 * Picks a clean *step* first and derives the top from it, rather than rounding
 * the top and dividing - dividing a "nice" maximum by four is what produces
 * ticks like 38 / 75 / 113. Pass `integer` for counted things, so a range of
 * two days cannot yield half-day gridlines.
 */
export function niceAxis(max: number, tickCount = 4, options: { integer?: boolean } = {}): Axis {
  if (!Number.isFinite(max) || max <= 0) {
    const step = options.integer ? 1 : 0.25;
    return { max: step * tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, i) => step * i) };
  }

  const rawStep = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const factor = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;

  let step = factor * magnitude;
  if (options.integer) step = Math.max(1, Math.ceil(step));

  return {
    max: step * tickCount,
    ticks: Array.from({ length: tickCount + 1 }, (_, index) => step * index),
  };
}
