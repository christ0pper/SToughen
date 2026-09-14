/**
 * The left-hand identity column from the employee frame.
 *
 * Everything here is fixed reference - who this is, what they are paid, when
 * they started. It stays put while the tabs beside it change, because it is the
 * context every one of those tabs is read against.
 */
export interface RailRow {
  icon: React.ReactNode;
  value: React.ReactNode;
  caption: string;
  /** Pay reads green, as it does in the source design. */
  tone?: 'good' | 'ink';
}

export interface ProfileRailProps {
  initials: string;
  name: string;
  subtitle: string;
  info: RailRow[];
  contact: RailRow[];
}

function Row({ row }: { row: RailRow }) {
  return (
    <div className="flex items-start gap-3">
      <span className="icon-tile mt-0.5">{row.icon}</span>
      <div className="min-w-0">
        <div
          className={`truncate text-[13px] font-semibold ${
            row.tone === 'good' ? 'text-good' : 'text-ink'
          }`}
        >
          {row.value}
        </div>
        <div className="text-xs text-ink-muted">{row.caption}</div>
      </div>
    </div>
  );
}

export function ProfileRail({ initials, name, subtitle, info, contact }: ProfileRailProps) {
  return (
    <aside className="card h-fit p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-strong">
          {initials || 'U'}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{name}</div>
          <div className="truncate text-xs text-ink-muted">{subtitle}</div>
        </div>
      </div>

      <h3 className="mb-3 mt-6 text-[13px] font-semibold text-ink">Info</h3>
      <div className="space-y-3.5">
        {info.map((row) => (
          <Row key={row.caption} row={row} />
        ))}
      </div>

      {contact.length > 0 ? (
        <>
          <h3 className="mb-3 mt-6 text-[13px] font-semibold text-ink">Contact</h3>
          <div className="space-y-3.5">
            {contact.map((row) => (
              <Row key={row.caption} row={row} />
            ))}
          </div>
        </>
      ) : null}
    </aside>
  );
}
