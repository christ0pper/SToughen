import Link from 'next/link';

/**
 * Next's own 404 is unstyled black-on-white and says "This page could not be
 * found" with no way back. A mistyped or stale link - a bookmarked period that
 * has since been deleted, say - is an ordinary event here, so it gets an
 * ordinary screen.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <div className="card w-full max-w-md p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Not found</p>
        <h1 className="page-title mt-2">That page is not here</h1>
        <p className="mt-2 text-sm text-ink-soft">
          The address may be mistyped, or it may point at a payroll period or employee that has
          since been deleted.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link className="btn btn-primary" href="/periods">
            Payroll periods
          </Link>
          <Link className="btn" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
