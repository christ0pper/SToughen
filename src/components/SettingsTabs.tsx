'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/settings', label: 'General' },
  { href: '/settings/accounts', label: 'Accounts' },
];

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav className="tabs">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`tab ${active ? 'tab-active' : ''}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
