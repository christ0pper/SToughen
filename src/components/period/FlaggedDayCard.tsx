import { ActionForm } from '@/components/ActionForm';
import { resolveDayAction } from '@/actions/periods';
import { formatClock, formatDuration } from '@/domain/time';
import { FLAG_LABELS, shortDate } from '@/lib/format';
import type { FlaggedDayRow } from '@/services/payrollService';

const TAGS = [
  { value: '', label: 'No tag' },
  { value: 'SANCTIONED_LEAVE', label: 'Sanctioned leave' },
  { value: 'UNAUTHORIZED_ABSENCE', label: 'Unauthorised absence' },
  { value: 'HALF_DAY', label: 'Half day' },
  { value: 'OTHER', label: 'Other (describe below)' },
];

export function FlaggedDayCard({ row, disabled }: { row: FlaggedDayRow; disabled: boolean }) {
  const day = row.computation;

  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold text-ink">{shortDate(day.date)}</span>
          <span className="ml-2 text-xs text-ink-soft">
            {row.employeeName} · {row.employeeCode} · {row.scheduleType}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {day.flags.map((flag) => (
            <span key={flag} className="pill pill-soft-warn">
              {FLAG_LABELS[flag] ?? flag}
            </span>
          ))}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-ink-soft">Punched</dt>
          <dd className="tabular-nums text-ink">
            {formatClock(day.rawInMinutes)} – {formatClock(day.rawOutMinutes)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Counted</dt>
          <dd className="tabular-nums text-ink">
            {day.effectiveInMinutes == null
              ? '—'
              : `${formatClock(day.effectiveInMinutes)} – ${formatClock(day.effectiveOutMinutes)}`}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Breaks</dt>
          <dd className="tabular-nums text-ink">{formatDuration(day.breakMinutes)}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Worked</dt>
          <dd className="tabular-nums font-medium text-ink">
            {formatDuration(day.creditedWorkMinutes)}
            <span className={day.deviationMinutes === 0 ? '' : 'ml-1 text-amber-700'}>
              ({day.deviationMinutes > 0 ? '+' : ''}
              {formatDuration(day.deviationMinutes)})
            </span>
          </dd>
        </div>
      </dl>

      {day.uncreditedMinutes > 0 ? (
        <p className="mt-2 text-xs text-ink-soft">
          {formatDuration(day.uncreditedMinutes)} punched outside the shift is not paid unless it is
          confirmed as overtime below.
        </p>
      ) : null}

      <ActionForm
        action={resolveDayAction}
        hidden={{ dayId: row.attendanceDayId }}
        submitLabel="Save"
        variant="primary"
        className="mt-4 border-t border-hairline pt-3"
      >
        <fieldset disabled={disabled} className="mb-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Resolution</label>
            <select name="resolutionTag" className="input" defaultValue={row.resolutionTag ?? ''}>
              {TAGS.map((tag) => (
                <option key={tag.value} value={tag.value}>
                  {tag.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Manual worked minutes</label>
            <input
              name="manualWorkedMinutes"
              type="number"
              min={0}
              className="input"
              placeholder={day.needsManualDuration ? 'Required' : 'Leave blank to keep calculated'}
              defaultValue={day.workedMinutes !== day.calculatedWorkedMinutes ? day.workedMinutes : ''}
            />
          </div>

          <div>
            <label className="label">Confirmed overtime (minutes)</label>
            <input
              name="confirmedOtMinutes"
              type="number"
              min={0}
              className="input"
              defaultValue={day.confirmedOtMinutes || ''}
              placeholder={day.uncreditedMinutes > 0 ? String(day.uncreditedMinutes) : '0'}
            />
          </div>

          <div>
            <label className="label">Paid leave minutes</label>
            <input
              name="paidLeaveMinutes"
              type="number"
              min={0}
              className="input"
              defaultValue={day.paidLeaveMinutes || ''}
              placeholder="0 — leave is unpaid by default"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">Note</label>
            <input
              name="resolutionNote"
              className="input"
              defaultValue={row.resolutionNote ?? ''}
              placeholder="Required when the resolution is Other"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="label">Punctuality override note</label>
            <input
              name="punctualityOverrideNote"
              className="input"
              defaultValue={row.punctualityOverrideNote ?? ''}
              placeholder="Required if granting the bonus despite this discrepancy"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" name="meritTicked" defaultChecked={day.meritAwarded} />
              Merit-eligible day
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                name="grantPunctualityOverride"
                defaultChecked={day.punctualityAwarded && day.isFlagged}
              />
              Grant punctuality bonus despite discrepancy
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" name="resolved" defaultChecked={day.isResolved} />
              Mark resolved
            </label>
          </div>
        </fieldset>
      </ActionForm>
    </div>
  );
}
