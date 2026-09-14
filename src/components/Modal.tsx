'use client';

import { useEffect, useRef } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel. */
  width?: string;
  /** Classes for the body wrapper, for dialogs that want their own padding or tone. */
  bodyClassName?: string;
}

/**
 * A centred dialog with a scrim.
 *
 * Escape and a backdrop click both close it, focus moves inside on open and the
 * page behind stops scrolling - the things a dialog has to do to not feel like
 * a div that appeared. The panel is capped to the viewport and its body does
 * the scrolling, so a long dialog never carries its close button off-screen.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 'max-w-3xl',
  bodyClassName = 'px-6 py-5',
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog so keyboard users are not left behind it.
    panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href]',
    )?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-full w-full ${width} flex-col rounded-lg bg-white shadow-xl border border-hairline`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 rounded-t-lg border-b border-hairline px-6 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-ink-soft">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-well hover:text-ink-soft"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
                 strokeLinecap="round" className="h-4 w-4" aria-hidden>
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={`overflow-y-auto ${bodyClassName}`}>{children}</div>
      </div>
    </div>
  );
}
