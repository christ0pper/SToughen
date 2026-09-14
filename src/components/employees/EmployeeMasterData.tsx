'use client';

import { useActionState, useEffect, useState } from 'react';
import { StatutoryFields } from './StatutoryFields';
import { updateEmployeeAction } from '@/actions/employees';
import type { ActionState } from '@/actions/periods';

export interface EmployeeMasterDataProps {
  admin: boolean;
  employee: {
    id: string;
    name: string;
    employeeCode: string;
    deviceId: string | null;
    /** Empty when nobody has recorded one. */
    joiningDateIso: string;
    joiningDateLabel: string;
    position: string | null;
    status: string;
    scheduleType: string;
    scheduleLabel: string;
    exceptionRole: string | null;
    esiApplicable: boolean;
    pfApplicable: boolean;
    contactNumber: string | null;
    address: string | null;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
  };
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ON_EXTENDED_LEAVE: 'On extended leave',
  INACTIVE: 'Left / inactive',
};

const initial: ActionState = {};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value || <span className="text-ink-muted">—</span>}</dd>
    </div>
  );
}

/**
 * Master data, read-only until Edit is pressed.
 *
 * A screen full of live inputs invites accidental edits and gives no signal
 * that anything was changed. Reading is the common case, so reading is the
 * default state and editing is a decision.
 *
 * Renders bare - it sits inside a tab panel, which supplies the surface.
 */
export function EmployeeMasterData({ admin, employee }: EmployeeMasterDataProps) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateEmployeeAction, initial);

  useEffect(() => {
    if (state.message) setEditing(false);
  }, [state.message]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">Master data</h2>
        {editing ? (
          <span className="card-note">
            {admin ? 'Editing' : 'Editing · bank details are Admin-only'}
          </span>
        ) : (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
                 strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
              <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {state.message && !editing ? (
        <p className="alert alert-good mb-4">{state.message}</p>
      ) : null}

      {!editing ? (
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={employee.name} />
          <Field label="Employee code" value={employee.employeeCode} />
          <Field
            label="Device ID"
            value={employee.deviceId ?? <span className="text-amber-600">not linked</span>}
          />
          <Field
            label="Joining date"
            value={
              employee.joiningDateIso ? (
                employee.joiningDateLabel
              ) : (
                <span className="text-warn-ink">not set · no holiday pay</span>
              )
            }
          />
          <Field label="Position" value={employee.position} />
          <Field label="Schedule" value={employee.scheduleLabel} />
          <Field label="Status" value={STATUS_LABELS[employee.status] ?? employee.status} />
          <Field
            label="ESI / PF"
            value={`${employee.esiApplicable ? 'ESI applies' : 'No ESI'} · ${
              employee.pfApplicable ? 'PF applies' : 'No PF'
            }`}
          />
          <Field label="Contact" value={employee.contactNumber} />
          <Field label="Address" value={employee.address} />
          <Field label="Bank" value={employee.bankName} />
          <Field
            label="Account"
            value={
              admin
                ? employee.bankAccountNumber
                : employee.bankAccountNumber
                  ? '••••••'
                  : null
            }
          />
        </dl>
      ) : (
        <form action={action}>
          <input type="hidden" name="employeeId" value={employee.id} />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Name</label>
              <input name="name" className="input" defaultValue={employee.name} />
            </div>
            <div>
              <label className="label">Employee code</label>
              <input name="employeeCode" className="input" defaultValue={employee.employeeCode} />
            </div>
            <div>
              <label className="label">Device ID</label>
              <input name="deviceId" className="input" defaultValue={employee.deviceId ?? ''} />
            </div>
            <div>
              <label className="label">Joining date</label>
              <input
                name="joiningDate"
                type="date"
                className="input"
                defaultValue={employee.joiningDateIso}
              />
            </div>
            <div>
              <label className="label">Position</label>
              <input name="position" className="input" defaultValue={employee.position ?? ''} />
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" className="input" defaultValue={employee.status}>
                <option value="ACTIVE">Active</option>
                <option value="ON_EXTENDED_LEAVE">On extended leave</option>
                <option value="INACTIVE">Left / inactive</option>
              </select>
            </div>

            <StatutoryFields
              initialScheduleType={employee.scheduleType}
              initialExceptionRole={employee.exceptionRole ?? 'MANAGER'}
              initialEsi={employee.esiApplicable}
              initialPf={employee.pfApplicable}
            />

            <div>
              <label className="label">Contact number</label>
              <input
                name="contactNumber"
                className="input"
                defaultValue={employee.contactNumber ?? ''}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input name="address" className="input" defaultValue={employee.address ?? ''} />
            </div>

            <div>
              <label className="label">Bank name</label>
              <input
                name="bankName"
                className="input"
                defaultValue={employee.bankName ?? ''}
                disabled={!admin}
              />
            </div>
            <div>
              <label className="label">Account number</label>
              <input
                name="bankAccountNumber"
                className="input"
                defaultValue={employee.bankAccountNumber ?? ''}
                disabled={!admin}
              />
            </div>
            <div>
              <label className="label">IFSC</label>
              <input
                name="bankIfsc"
                className="input"
                defaultValue={employee.bankIfsc ?? ''}
                disabled={!admin}
              />
            </div>
          </div>

          {state.error ? (
            <p className="alert alert-bad mt-4">
              {state.error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2 border-t border-hairline pt-4">
            <button type="button" className="btn btn-subtle" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
