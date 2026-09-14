/**
 * The stepped bar block from the attendance frame.
 *
 * Bars are sorted tallest first and labelled inside themselves, so the figure
 * and its name travel together and no legend is needed.
 *
 * Heights are a true proportion of the largest bar, with one concession: a bar
 * that has a real value never shrinks below the height its own label needs, or
 * the label would spill out of it. A zero is drawn as no bar at all, sitting on
 * the baseline with its label above it - shrinking a zero to "very short" would
 * read as a small amount rather than none.
 */
export interface Bar {
  value: number;
  /** The figure as the reader should see it - "23 days". */
  display: string;
  caption: string;
}

const PLOT = 190;
const MIN_LABELLED = 58;

export function BarBreakdown({ bars }: { bars: Bar[] }) {
  const sorted = [...bars].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 0;

  return (
    <div
      className="flex items-end gap-3 overflow-x-auto border-b border-hairline pb-0"
      style={{ height: PLOT + 46 }}
    >
      {sorted.map((bar) => {
        const share = max > 0 ? bar.value / max : 0;
        const height = bar.value === 0 ? 0 : Math.max(MIN_LABELLED, Math.round(share * PLOT));
        const inside = height >= MIN_LABELLED;

        return (
          <div key={bar.caption} className="flex min-w-25 flex-1 flex-col justify-end">
            {inside ? null : (
              <div className="px-1 pb-2">
                <div className="text-sm font-semibold leading-tight text-ink-muted">
                  {bar.display}
                </div>
                <div className="text-xs text-ink-muted">{bar.caption}</div>
              </div>
            )}
            {height > 0 ? (
              <div
                className="rounded-t-md border border-b-0 border-brand bg-brand-soft px-3 pt-2.5"
                style={{ height }}
              >
                <div className="text-sm font-semibold leading-tight text-ink">{bar.display}</div>
                <div className="text-xs text-ink-soft">{bar.caption}</div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
