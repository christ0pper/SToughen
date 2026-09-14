import { db } from '@/lib/db';
import { getSession, isAdmin } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import {
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  setUserActiveAction,
  updateUserAction,
} from '@/actions/users';

export const dynamic = 'force-dynamic';

export default async function AccountsSettingsPage() {
  const user = await getSession();
  const admin = isAdmin(user);

  const users = await db.user.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });

  if (!admin) {
    return (
      <section className="card p-6">
        <p className="text-sm text-ink-soft">
          Only an Admin can manage accounts. You can change your own password on the General tab.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* accounts ------------------------------------------------------------ */}
      {admin ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Accounts</h2>
            <span className="text-xs text-ink-soft">
              Admin only · {users.filter((account) => account.isActive).length} of {users.length} active
            </span>
          </div>

          <div className="divide-y divide-hairline">
            {users.map((account) => (
              <div key={account.id} className="p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{account.name}</span>
                  {account.id === user?.id ? (
                    <span className="pill pill-soft-brand">you</span>
                  ) : null}
                  <span
                    className={`pill ${
                      account.isActive ? 'pill-good' : 'pill-neutral'
                    }`}
                  >
                    {account.isActive ? 'Active' : 'Disabled'}
                  </span>
                  <span className="text-xs text-ink-soft">added {dateTime(account.createdAt)}</span>
                </div>

                {/* name, email and role - all changeable */}
                <ActionForm
                  action={updateUserAction}
                  hidden={{ userId: account.id }}
                  submitLabel="Save details"
                  variant="primary"
                >
                  <div className="mb-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label">Name</label>
                      <input name="name" className="input" defaultValue={account.name} required />
                    </div>
                    <div>
                      <label className="label">Email</label>
                      <input
                        name="email"
                        type="email"
                        className="input"
                        defaultValue={account.email}
                        required
                      />
                    </div>
                    <div>
                      <label className="label">Role</label>
                      <select name="role" className="input" defaultValue={account.role}>
                        <option value="HR_ACCOUNTANT">HR / Accountant</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </div>
                  </div>
                </ActionForm>

                <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-hairline pt-3">
                  <ActionForm
                    action={resetPasswordAction}
                    hidden={{ userId: account.id }}
                    submitLabel="Set password"
                    className="flex items-start gap-2"
                  >
                    <input
                      name="password"
                      type="password"
                      className="input w-36"
                      placeholder="New password"
                      autoComplete="new-password"
                    />
                    <input
                      name="confirm"
                      type="password"
                      className="input w-36"
                      placeholder="Confirm"
                      autoComplete="new-password"
                    />
                  </ActionForm>

                  {account.id === user?.id ? null : (
                    <>
                      <ActionForm
                        action={setUserActiveAction}
                        hidden={{ userId: account.id, active: account.isActive ? 'false' : 'true' }}
                        submitLabel={account.isActive ? 'Disable' : 'Enable'}
                        confirm={
                          account.isActive
                            ? `Disable ${account.name}? They will not be able to sign in.`
                            : undefined
                        }
                      />
                      <ActionForm
                        action={deleteUserAction}
                        hidden={{ userId: account.id }}
                        submitLabel="Delete"
                        variant="danger"
                        confirm={`Permanently delete ${account.name}? Refused if they have any recorded activity - disable them instead.`}
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-hairline px-5 py-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Add an account
            </h3>
            <ActionForm action={createUserAction} submitLabel="Create account">
              <div className="mb-3 grid gap-3 sm:grid-cols-5">
                <div>
                  <label className="label">Name</label>
                  <input name="name" className="input" required />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input name="email" type="email" className="input" required />
                </div>
                <div>
                  <label className="label">Role</label>
                  <select name="role" className="input" defaultValue="HR_ACCOUNTANT">
                    <option value="HR_ACCOUNTANT">HR / Accountant</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="label">Password</label>
                  <input
                    name="password"
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div>
                  <label className="label">Confirm</label>
                  <input
                    name="confirm"
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
            </ActionForm>
            <p className="mt-2 text-xs text-ink-soft">
              An account that has approved payroll, imported a file or left an audit entry cannot be
              deleted - disabling keeps that history attributable. Deletion is for accounts created
              in error.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
