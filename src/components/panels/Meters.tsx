/**
 * The two halves of the template's log panel: a row of plain count chips, and a
 * column of labelled meters.
 *
 * The meters are all drawn against the same denominator, so their lengths are
 * comparable to each other and not just to themselves - a bar that means
 * something different in every row is decoration.
 */

export function CountChip({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="rounded-md bg-well px-4 py-3">
      <div className="text-lg font-semibold leading-none tracking-tight text-ink">{value}</div>
      <div className="mt-1.5 text-xs text-ink-muted">{caption}</div>
    </div>
  );
}

export interface MeterProps {
  label: string;
  value: string;
  /** 0-1, against the panel's shared denominator. */
  share: number;
}

export function Meter({ label, value, share }: MeterProps) {
  const width = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="text-xs font-medium tabular-nums text-ink">{value}</span>
      </div>
      <div className="progress mt-1.5">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
