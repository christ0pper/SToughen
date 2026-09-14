/**
 * The four-across headline strip.
 *
 * One bordered surface split by dividers rather than four separate cards: the
 * figures are read together, as one row of the same period, and separating them
 * into cards makes each look like its own subject.
 *
 * Each cell carries a headline figure and the two parts it breaks into. The
 * second part is the one that usually wants attention, so it takes the warning
 * tone when the caller says it should.
 */
export interface KpiPart {
  label: string;
  value: string;
  /** 'bad' for the half that means work outstanding. Defaults to neutral. */
  tone?: 'brand' | 'bad' | 'muted';
}

export interface KpiCell {
  label: string;
  value: string;
  parts: KpiPart[];
}

const PART_TONE: Record<NonNullable<KpiPart['tone']>, string> = {
  brand: 'text-brand',
  bad: 'text-bad',
  muted: 'text-ink-soft',
};

export function KpiStrip({ cells }: { cells: KpiCell[] }) {
  return (
    <div className="grid divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          className={`px-5 py-4 ${index > 0 ? 'sm:border-l sm:border-hairline' : ''} ${
            index === 2 ? 'sm:border-l-0 lg:border-l' : ''
          } ${index >= 2 ? 'border-t border-hairline sm:border-t lg:border-t-0' : ''}`}
        >
          <div className="text-[13px] text-ink-soft">{cell.label}</div>
          <div className="mt-1.5 text-[30px] font-bold leading-none tracking-tight text-brand">
            {cell.value}
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {cell.parts.map((part) => (
              <span key={part.label} className="text-xs text-ink-muted">
                {part.label}{' '}
                <span className={`font-medium tabular-nums ${PART_TONE[part.tone ?? 'muted']}`}>
                  {part.value}
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
