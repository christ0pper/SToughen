'use client';

import { useState } from 'react';

export interface StatutoryFieldsProps {
  /** The schedule select this component reacts to - "name" must match the form field. */
  scheduleName?: string;
  exceptionRoleName?: string;
  initialScheduleType: string;
  initialExceptionRole?: string;
  initialEsi: boolean;
  initialPf: boolean;
}

const SCHEDULE_OPTIONS = [
  { value: 'OS', label: 'Office Staff — 09:00–18:00' },
  { value: 'PS', label: 'Plant Staff — 08:00–17:00' },
  { value: 'NS', label: 'Night Staff — 22:00–06:00' },
  { value: 'EXCEPTION', label: 'Exception role — manual hours' },
];

const EXCEPTION_ROLE_OPTIONS = [
  { value: 'SALESMAN', label: 'Salesman' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'DRIVER', label: 'Driver' },
];

/**
 * Schedule, exception role, and the ESI/PF checkboxes, wired together.
 *
 * Spec 12.11 says exception roles (manager, driver, salesman, security) are
 * "not applicable" for ESI/PF, while punch-based workers normally carry them.
 * That is treated as a DEFAULT, not a hard rule: switching the schedule
 * suggests the usual setting for ESI and PF, but HR/Admin can tick either box
 * on or off for any individual employee - a manager who does carry PF, a
 * worker who is exempt, and so on. Once a checkbox has been touched by hand,
 * changing the schedule again no longer overwrites that choice.
 */
export function StatutoryFields({
  scheduleName = 'scheduleType',
  exceptionRoleName = 'exceptionRole',
  initialScheduleType,
  initialExceptionRole = 'MANAGER',
  initialEsi,
  initialPf,
}: StatutoryFieldsProps) {
  const [scheduleType, setScheduleType] = useState(initialScheduleType);
  const [exceptionRole, setExceptionRole] = useState(initialExceptionRole);
  const [esiChecked, setEsiChecked] = useState(initialEsi);
  const [pfChecked, setPfChecked] = useState(initialPf);
  const [esiTouched, setEsiTouched] = useState(false);
  const [pfTouched, setPfTouched] = useState(false);

  const isException = scheduleType === 'EXCEPTION';

  const handleScheduleChange = (value: string) => {
    setScheduleType(value);
    // Default: ESI/PF apply to punch-based workers, not to exception roles
    // (spec 12.11) - but only for a box the admin hasn't already decided.
    if (!esiTouched) setEsiChecked(value !== 'EXCEPTION');
    if (!pfTouched) setPfChecked(value !== 'EXCEPTION');
  };

  return (
    <>
      <div>
        <label className="label">Schedule</label>
        <select
          name={scheduleName}
          className="input"
          value={scheduleType}
          onChange={(event) => handleScheduleChange(event.target.value)}
        >
          {SCHEDULE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">
          Exception role{isException ? '' : ' (if applicable)'}
        </label>
        <select
          name={exceptionRoleName}
          className="input"
          value={exceptionRole}
          disabled={!isException}
          onChange={(event) => setExceptionRole(event.target.value)}
        >
          {EXCEPTION_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:col-span-3">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            name="esiApplicable"
            checked={esiChecked}
            onChange={(event) => {
              setEsiTouched(true);
              setEsiChecked(event.target.checked);
            }}
          />
          ESI applies
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            name="pfApplicable"
            checked={pfChecked}
            onChange={(event) => {
              setPfTouched(true);
              setPfChecked(event.target.checked);
            }}
          />
          PF applies
        </label>
        <span className="text-xs text-ink-soft">
          {isException
            ? 'Off by default for exception roles - tick to opt this employee in.'
            : 'On by default for workers - untick if this employee is exempt.'}
        </span>
      </div>
    </>
  );
}
