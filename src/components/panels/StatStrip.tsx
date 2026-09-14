/**
 * The thin divided figure row that sits under the attendance bars.
 *
 * Same shape as KpiStrip but without the breakdown, and at body scale rather
 * than headline scale - these are supporting figures, not the subject.
 */
export interface StatCell {
  value: string;
  caption: string;
  /** Money earned reads green, a shortfall reads red - everything else is ink. */
  tone?: 'good' | 'bad' | 'ink';
}

const TONE: Record<NonNullable<StatCell['tone']>, string> = {
  good: 'text-good',
  bad: 'text-bad',
  ink: 'text-ink',
};

export function StatStrip({ cells }: { cells: StatCell[] }) {
  return (
    <div className="grid grid-cols-2 divide-hairline overflow-hidden rounded-lg border border-hairline bg-white sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
      {cells.map((cell, index) => (
        <div
          key={cell.caption}
          className={`px-4 py-3 ${index > 0 ? 'border-l border-hairline lg:border-l-0' : ''} ${
            index >= 2 ? 'border-t border-hairline sm:border-t lg:border-t-0' : ''
          } ${index === 3 ? 'sm:border-l-0 lg:border-l-0' : ''}`}
        >
          <div className={`text-[15px] font-semibold tabular-nums ${TONE[cell.tone ?? 'ink']}`}>
            {cell.value}
          </div>
          <div className="mt-1 text-xs leading-snug text-ink-muted">{cell.caption}</div>
        </div>
      ))}
    </div>
  );
}
