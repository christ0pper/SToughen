import { redirect } from 'next/navigation';
import { authBypassEnabled, getSession } from '@/lib/auth';
import { signOut } from '@/actions/auth';
import { AppShell } from '@/components/AppShell';
import { initialsOf } from '@/lib/format';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect('/login');

  const bypassed = authBypassEnabled();

  return (
    <AppShell
      userName={user.name}
      roleLabel={user.role === 'ADMIN' ? 'Admin' : 'HR / Accountant'}
      initials={initialsOf(user.name)}
      signOut={signOut}
    >
      {/* A bypass nobody can see is a bypass that ships. This sits above every
          screen for as long as AUTH_DISABLED is set. */}
      {bypassed ? (
        <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-300 bg-bad-soft px-4 py-2.5 text-[13px] text-red-800">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
               strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
            <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 17.6A1.9 1.9 0 0 0 4 20.5h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
          </svg>
          <strong className="font-semibold">Sign-in is switched off.</strong>
          <span>
            Anyone who can reach this machine is signed in as {user.name}. Remove{' '}
            <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-xs">AUTH_DISABLED</code>{' '}
            from <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-xs">.env</code>{' '}
            before this leaves your machine.
          </span>
        </div>
      ) : null}

      {children}
    </AppShell>
  );
}
