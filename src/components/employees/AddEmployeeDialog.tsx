'use client';

import { useActionState, useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { StatutoryFields } from './StatutoryFields';
import { PayInput } from './PayInput';
import { createEmployeeAction } from '@/actions/employees';
import type { ActionState } from '@/actions/periods';

const initial: ActionState = {};

/** Adds an employee in a dialog, so the directory stays the page's subject. */
export function AddEmployeeDialog({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createEmployeeAction, initial);

  // The server action revalidates the list; close once it reports success.
  useEffect(() => {
    if (state.message) setOpen(false);
  }, [state.message]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             strokeLinecap="round" className="h-4 w-4" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add employee
      </button>

      {state.message ? (
        <span className="text-sm text-emerald-700">{state.message}</span>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add an employee"
        description="They appear in the next payroll run once their Device ID matches the monthly file."
      >
        <form action={action}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input name="name" className="input" required autoComplete="off" />
            </div>
            <div>
              <label className="label">Biometric device ID</label>
              <input
                name="deviceId"
                className="input"
                placeholder="Leave blank if not yet known"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">Joining date</label>
              <input name="joiningDate" type="date" className="input" />
              <p className="mt-1 text-xs text-ink-muted">
                Optional. Only holiday pay depends on it.
              </p>
            </div>
            <div>
              <label className="label">Position</label>
              <input name="position" className="input" autoComplete="off" />
            </div>
            <div>
              <label className="label">Contact number</label>
              <input name="contactNumber" className="input" autoComplete="off" />
            </div>
            {admin ? <PayInput /> : null}
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input name="address" className="input" autoComplete="off" />
            </div>
          </div>

          <div className="mt-4 grid gap-4 border-t border-hairline pt-4 sm:grid-cols-3">
            <StatutoryFields
              initialScheduleType="PS"
              initialExceptionRole="MANAGER"
              initialEsi
              initialPf
            />
          </div>

          {state.error ? (
            <p className="alert alert-bad mt-4">
              {state.error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2 border-t border-hairline pt-4">
            <button type="button" className="btn btn-subtle" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Creating…' : 'Create employee'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
