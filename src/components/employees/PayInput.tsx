'use client';

import { useEffect, useRef, useState } from 'react';

export interface PayInputProps {
  defaultBasis?: 'HOURLY' | 'MONTHLY';
  required?: boolean;
}

type Basis = 'HOURLY' | 'MONTHLY';
const asBasis = (value: string): Basis => (value === 'MONTHLY' ? 'MONTHLY' : 'HOURLY');

/**
 * How someone is paid, and how much.
 *
 * The amount box relabels itself when the basis changes, so the number typed is
 * always read against the right unit. The rate sheet this was built from had
 * monthly salaries typed into a column headed "hourly" - one of them would have
 * paid 1.3 crore for a month - and a box that says what it expects is the
 * cheapest defence against that. The server refuses the obvious mismatches too.
 *
 * The dropdown is left uncontrolled and the label follows the DOM, never the
 * other way round. React resets a form after its action runs, which puts a
 * select back to its first option; a controlled select kept its own state
 * through that, so after a refused save the dropdown read "Fixed monthly salary"
 * while the box beneath it read "Hourly rate". An amount valid either way, such
 * as 5,000, would then have saved on a basis nobody chose. Reading the DOM after
 * every reset keeps the two agreeing.
 *
 * Renders two grid cells, so it drops into an existing form grid.
 */
export function PayInput({ defaultBasis = 'HOURLY', required = false }: PayInputProps) {
  const select = useRef<HTMLSelectElement>(null);
  const [basis, setBasis] = useState<Basis>(defaultBasis);
  const monthly = basis === 'MONTHLY';

  useEffect(() => {
    const form = select.current?.form;
    if (!form) return;
    // The reset event fires before the fields are restored, so read them on the
    // next frame, once the dropdown holds its restored value.
    const onReset = () => {
      requestAnimationFrame(() => {
        if (select.current) setBasis(asBasis(select.current.value));
      });
    };
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, []);

  return (
    <>
      <div>
        <label className="label">Paid</label>
        <select
          ref={select}
          name="payBasis"
          className="input"
          defaultValue={defaultBasis}
          onChange={(event) => setBasis(asBasis(event.target.value))}
        >
          <option value="HOURLY">By the hour</option>
          <option value="MONTHLY">Fixed monthly salary</option>
        </select>
      </div>
      <div>
        <label className="label">{monthly ? 'Monthly salary (₹)' : 'Hourly rate (₹)'}</label>
        <input
          name="payAmount"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          className="input"
          required={required}
          placeholder={monthly ? 'e.g. 45000' : 'e.g. 95'}
        />
        <p className="mt-1 text-xs text-ink-muted">
          {monthly
            ? 'Paid in full each month, whatever the punches show.'
            : 'Paid for each payable hour worked.'}
        </p>
      </div>
    </>
  );
}
