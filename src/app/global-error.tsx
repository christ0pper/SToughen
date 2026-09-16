'use client';

/**
 * The last resort: a failure in the root layout itself, where the app's own
 * styles and shell are not available. It replaces the whole document, so it
 * carries its own minimal styling and nothing else.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f6f7f9',
          color: '#1b1f24',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '32rem', background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '2rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.35rem' }}>The payroll app could not start</h1>
          <p style={{ color: '#5b6573', fontSize: '0.9rem' }}>
            Nothing was changed. Try again, and if it keeps happening the hosting log has the
            detail{error.digest ? ` under ${error.digest}` : ''}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: '0.5rem', padding: '0.5rem 0.9rem', borderRadius: 8, border: '1px solid #1b1f24', background: '#1b1f24', color: '#fff', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
