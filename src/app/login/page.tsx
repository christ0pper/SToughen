'use client';

import { useActionState } from 'react';
import { signIn, type FormState } from '@/actions/auth';

const initial: FormState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* brand panel */}
      <div className="relative hidden flex-col justify-between bg-action p-12 text-white lg:flex">
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-brand text-lg font-bold">
          P
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight">
            Payroll, calculated from the punch clock.
          </h1>
          <p className="mt-4 max-w-md text-sm text-white/80">
            Upload the monthly biometric export, review everything the rules cannot decide on their
            own, and approve. Every figure keeps its history.
          </p>
        </div>
        <p className="text-xs text-white/60">Internal tool · no employee access</p>
      </div>

      {/* form */}
      <div className="flex items-center justify-center px-6 py-12">
        <form action={action} className="card w-full max-w-sm p-7">
          <h2 className="text-xl font-bold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">Internal use only.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Username
              </label>
              <input
                id="email"
                name="email"
                type="text"
                autoComplete="username"
                className="input"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="input"
                required
              />
            </div>
          </div>

          {state.error ? (
            <p className="alert alert-bad mt-4 whitespace-pre-line" role="alert">
              {state.error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary mt-6 w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
