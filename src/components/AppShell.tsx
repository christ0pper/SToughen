'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarIcon,
  ClipboardIcon,
  GearIcon,
  GridIcon,
  UsersIcon,
  type IconProps,
} from './Icons';

interface NavItem {
  href: string;
  label: string;
  hint: string;
  Icon: (props: IconProps) => React.ReactElement;
}

const MAIN: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', hint: 'Trends across every period', Icon: GridIcon },
  { href: '/periods', label: 'Payroll periods', hint: 'Run and approve a month', Icon: CalendarIcon },
  { href: '/employees', label: 'Employees', hint: 'People, rates and deductions', Icon: UsersIcon },
  { href: '/audit', label: 'Audit trail', hint: 'Who changed what', Icon: ClipboardIcon },
];

const FOOT: NavItem[] = [
  { href: '/settings', label: 'Settings', hint: 'Rules, holidays, accounts', Icon: GearIcon },
];

function MenuIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" className={className} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" className={className} aria-hidden>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export interface AppShellProps {
  userName: string;
  roleLabel: string;
  initials: string;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}

/**
 * App chrome for both sizes.
 *
 * Desktop keeps the labelled sidebar - light, with the active item marked by a
 * grey pill rather than a colour slab, so the only saturated thing on screen is
 * data. On a phone a fixed sidebar would eat most of the screen, so it collapses
 * into a top bar with a drawer - the app is used on handsets as well as desktops.
 */
export function AppShell({ userName, roleLabel, initials, signOut, children }: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Navigating should always leave the drawer closed behind you.
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const renderLink = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={item.hint}
        className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition ${
          active
            ? 'bg-well font-medium text-ink'
            : 'text-ink-soft hover:bg-well/70 hover:text-ink'
        }`}
      >
        <item.Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  const nav = (
    <>
      <Link href="/dashboard" className="mb-6 flex items-center gap-2.5 px-1 py-1">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand text-sm font-bold text-white">
          P
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-ink">Payroll</span>
      </Link>
      <nav className="flex flex-col gap-1">{MAIN.map(renderLink)}</nav>
      <div className="mt-auto flex flex-col gap-1">{FOOT.map(renderLink)}</div>
    </>
  );

  const userChip = (
    <div className="flex items-center gap-2.5 rounded-md border border-hairline bg-white px-3 py-1.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-strong">
        {initials || 'U'}
      </span>
      <span className="hidden text-xs leading-tight sm:block">
        <span className="block font-medium text-ink">{userName}</span>
        <span className="block text-ink-muted">{roleLabel}</span>
      </span>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-hairline bg-shell p-4 lg:flex">
        {nav}
      </aside>

      {/* mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex h-full w-[248px] flex-col border-r border-hairline bg-shell p-4">{nav}</div>
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-3 px-4 pb-2 pt-4 sm:px-6 lg:px-8 lg:pt-6">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-hairline bg-white text-ink-soft lg:hidden"
            onClick={() => setOpen(true)}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {userChip}
            <form action={signOut}>
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="grid h-9 w-9 place-items-center rounded-md border border-hairline bg-white text-ink-soft transition hover:text-ink"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
                     strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
                  <path d="M10 17l-5-5 5-5M5 12h11" />
                </svg>
              </button>
            </form>
          </div>
        </header>

        <main className="px-4 pb-12 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
