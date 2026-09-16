'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * What a screen shows when rendering it throws.
 *
 * Next's default in production is a bare "Application error: a server-side
 * exception has occurred", which tells the person at the keyboard nothing and
 * offers them nothing to do. The real message is deliberately withheld from the
 * browser - it can carry connection strings - so this screen shows the digest
 * instead, which is what identifies the entry in the hosting log, and a retry:
 * the most common cause here is a database that was briefly out of connections,
 * and that succeeds on a second attempt.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[screen] render failed', error);
  }, [error]);

  return (
    <main className="grid min-h-[60vh] place-items-center px-6 py-16">
      <div className="card w-full max-w-lg p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Error</p>
        <h1 className="page-title mt-2">This screen could not be loaded</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Nothing was changed. This is usually the database being momentarily out of connections,
          which passes - try again first.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <Link className="btn" href="/periods">
            Payroll periods
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-6 border-t border-hairline pt-4 text-xs text-ink-muted">
            If it keeps happening, quote this when asking for help:{' '}
            <code className="rounded bg-thead px-1.5 py-0.5 font-mono">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </main>
  );
}
