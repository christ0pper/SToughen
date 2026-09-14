'use client';

import { useActionState } from 'react';
import { type ActionState } from '@/lib/actionResult';

const initial: ActionState = {};

export interface ActionFormProps {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  /** Defaults to 'primary' when the form has fields, 'default' when it is a bare action. */
  variant?: 'primary' | 'default' | 'danger' | 'subtle';
  /** Hidden fields, so callers do not have to write input elements for ids. */
  hidden?: Record<string, string>;
  confirm?: string;
}

/** A tick that draws itself, so a result that arrives is seen to arrive. */
function DrawnCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
         strokeLinecap="round" strokeLinejoin="round"
         className="check-draw mt-0.5 h-4 w-4 shrink-0" aria-hidden>
      <path d="m4 12.5 5.5 5.5L20 7" />
    </svg>
  );
}

function WarningMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
         strokeLinecap="round" strokeLinejoin="round"
         className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16h.01" />
    </svg>
  );
}

/**
 * Wraps a server action with pending state and inline success/error feedback,
 * so every mutation on a screen reports back in the same place and shape.
 *
 * On anything slow enough to have been given a pendingLabel, a sweeping bar
 * runs underneath while the server works. It is deliberately indeterminate: a
 * server action returns once, at the end, so a bar that filled steadily would
 * be inventing a number. When the answer lands, the result rises into place
 * with a tick that draws itself, and any figures the action reported count in
 * beside it - because "did it read my file" is answered by numbers, not by a
 * sentence saying it worked.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  className,
  variant,
  hidden,
  confirm,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, initial);

  // A form with fields is committing something, and this system draws that
  // button near-black. A bare one-button form is a row action, and stays quiet.
  // A form whose children are only prose should pass `variant` explicitly -
  // see the "Ignore this block" action on a payroll period.
  const effective = variant ?? (children ? 'primary' : 'default');
  const variantClass =
    effective === 'primary'
      ? 'btn btn-primary'
      : effective === 'danger'
        ? 'btn btn-danger'
        : effective === 'subtle'
          ? 'btn btn-subtle'
          : 'btn';

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}

      {children}

      <button type="submit" className={variantClass} disabled={pending}>
        {pending ? <span className="spinner" aria-hidden /> : null}
        {pending ? (pendingLabel ?? 'Working…') : submitLabel}
      </button>

      {/* Only where the caller expects a wait - a bar flashing on every row
          action would be noise. */}
      {pending && pendingLabel ? (
        // The button already says what is happening; the bar only has to show
        // that it is still happening.
        <div className="mt-2.5 max-w-md" role="status" aria-live="polite">
          <div className="sweep">
            <span />
          </div>
          <span className="sr-only">{pendingLabel}</span>
        </div>
      ) : null}

      {state.error ? (
        <p
          key={state.error}
          className="alert alert-bad animate-rise mt-2 flex items-start gap-2 whitespace-pre-line"
          role="alert"
        >
          <WarningMark />
          <span>{state.error}</span>
        </p>
      ) : null}

      {state.message ? (
        <div key={state.message} className="animate-rise mt-2" role="status" aria-live="polite">
          <p className="alert alert-good flex items-start gap-2">
            <DrawnCheck />
            <span>{state.message}</span>
          </p>

          {state.stats && state.stats.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {state.stats.map((stat, index) => (
                <span
                  key={stat.label}
                  className={`animate-pop inline-flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 ${
                    stat.tone === 'warn'
                      ? 'border-warn-ring bg-warn-soft text-warn-ink'
                      : 'border-hairline bg-white text-ink'
                  }`}
                  // Staggered, so the eye reads them left to right rather than
                  // having all of them appear at once.
                  style={{ animationDelay: `${120 + index * 70}ms` }}
                >
                  <strong className="text-[15px] font-semibold tabular-nums">{stat.value}</strong>
                  <span className="text-xs text-ink-muted">{stat.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
