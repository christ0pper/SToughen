import { SettingsTabs } from '@/components/SettingsTabs';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Accounts, public holidays and the calculation rules. Employees are managed on the
          Employees tab.
        </p>
      </div>

      <SettingsTabs />
      {children}
    </div>
  );
}
