'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { fail, ok, type ActionState } from '@/lib/actionResult';
import { recordAudit, recordFieldChanges } from '@/lib/audit';
import { hashPassword, requireAdmin, requireUser, verifyPassword } from '@/lib/auth';

/**
 * Deliberately modest: length only. A rule that forces one digit and one symbol
 * mostly produces "Password1!", and the spec leaves the policy open - so this
 * is the floor, not a recommendation to stop here.
 */
const MIN_PASSWORD_LENGTH = 12;

function checkPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

export async function createUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();

    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const name = String(formData.get('name') ?? '').trim();
    const role = String(formData.get('role') ?? 'HR_ACCOUNTANT');
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    if (!email || !email.includes('@')) return { error: 'Enter a valid email address.' };
    if (!name) return { error: 'Enter a name.' };
    if (!['ADMIN', 'HR_ACCOUNTANT'].includes(role)) return { error: 'Choose a role.' };

    const problem = checkPassword(password, confirm);
    if (problem) return { error: problem };

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return { error: `${email} already has an account.` };

    const user = await db.user.create({
      data: { email, name, role, passwordHash: hashPassword(password) },
    });

    await recordAudit({
      userId: admin.id,
      action: 'FIELD_UPDATE',
      entityType: 'User',
      entityId: user.id,
      field: 'created',
      newValue: { email, name, role },
    });

    revalidatePath('/settings');
    return ok(`${name} can now sign in.`);
  } catch (error) {
    return fail(error);
  }
}

export async function setUserActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const userId = String(formData.get('userId'));
    const active = formData.get('active') === 'true';

    if (userId === admin.id && !active) {
      return { error: 'You cannot deactivate your own account.' };
    }

    const target = await db.user.findUniqueOrThrow({ where: { id: userId } });

    if (!active && target.role === 'ADMIN') {
      const admins = await db.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) return { error: 'That is the last active Admin. Promote someone first.' };
    }

    await db.user.update({ where: { id: userId }, data: { isActive: active } });

    await recordAudit({
      userId: admin.id,
      action: 'FIELD_UPDATE',
      entityType: 'User',
      entityId: userId,
      field: 'isActive',
      oldValue: target.isActive,
      newValue: active,
    });

    revalidatePath('/settings');
    return ok(active ? `${target.name} reactivated.` : `${target.name} deactivated.`);
  } catch (error) {
    return fail(error);
  }
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const userId = String(formData.get('userId'));
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    const problem = checkPassword(password, confirm);
    if (problem) return { error: problem };

    const target = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await db.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(password) } });

    // The value is never logged - only that it changed, and by whom.
    await recordAudit({
      userId: admin.id,
      action: 'FIELD_UPDATE',
      entityType: 'User',
      entityId: userId,
      field: 'passwordHash',
      newValue: 'reset by Admin',
    });

    revalidatePath('/settings');
    return ok(`Password reset for ${target.name}. Pass it on out of band.`);
  } catch (error) {
    return fail(error);
  }
}

export async function changeOwnPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const current = String(formData.get('current') ?? '');
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!verifyPassword(current, record.passwordHash)) {
      return { error: 'Your current password is not correct.' };
    }

    const problem = checkPassword(password, confirm);
    if (problem) return { error: problem };
    if (verifyPassword(password, record.passwordHash)) {
      return { error: 'That is already your password.' };
    }

    await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) } });

    await recordAudit({
      userId: user.id,
      action: 'FIELD_UPDATE',
      entityType: 'User',
      entityId: user.id,
      field: 'passwordHash',
      newValue: 'changed by the account holder',
    });

    revalidatePath('/settings');
    return ok('Password changed.');
  } catch (error) {
    return fail(error);
  }
}

/** Everything about an account except its password: name, email and role. */
export async function updateUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const userId = String(formData.get('userId'));

    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const role = String(formData.get('role') ?? before.role);

    if (!name) return { error: 'Enter a name.' };
    if (!email || !email.includes('@')) return { error: 'Enter a valid email address.' };
    if (!['ADMIN', 'HR_ACCOUNTANT'].includes(role)) return { error: 'Choose a role.' };

    if (email !== before.email) {
      const clash = await db.user.findUnique({ where: { email } });
      if (clash && clash.id !== userId) return { error: `${email} already has an account.` };
    }

    // Demoting yourself would lock you out of the very screen you are on.
    if (userId === admin.id && role !== 'ADMIN') {
      return { error: 'You cannot remove your own Admin role. Ask another Admin to do it.' };
    }

    // Never leave the system without an Admin who can approve payroll.
    if (before.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await db.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) return { error: 'That is the last active Admin. Promote someone else first.' };
    }

    const update = { name, email, role };
    await db.user.update({ where: { id: userId }, data: update });

    await recordFieldChanges(
      { userId: admin.id, entityType: 'User', entityId: userId },
      before as unknown as Record<string, unknown>,
      update as unknown as Record<string, unknown>,
    );

    revalidatePath('/settings');
    return ok(`${name} updated.`);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Permanently remove an account.
 *
 * Refused once the account has done anything on the record. Every audit entry
 * and sign-off points at the user by id, and deleting them would blank the
 * "who" on work that has already happened - which is the one thing an audit
 * trail exists to preserve (spec 19). Disabling keeps the history intact and
 * still stops them signing in, so that is the answer for a real leaver;
 * deletion is only for an account created by mistake.
 */
export async function deleteUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const userId = String(formData.get('userId'));

    if (userId === admin.id) return { error: 'You cannot delete your own account.' };

    const target = await db.user.findUniqueOrThrow({ where: { id: userId } });

    if (target.role === 'ADMIN') {
      const admins = await db.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) return { error: 'That is the last active Admin. Promote someone else first.' };
    }

    const [audits, locks, imports, rates, deductions, extras, zeroPunch, unmatched] =
      await Promise.all([
        db.auditLog.count({ where: { userId } }),
        db.payrollPeriod.count({ where: { lockedById: userId } }),
        db.importBatch.count({ where: { uploadedById: userId } }),
        db.employeeRate.count({ where: { createdById: userId } }),
        db.deduction.count({ where: { createdById: userId } }),
        db.extraBonus.count({ where: { createdById: userId } }),
        db.zeroPunchReview.count({ where: { decidedById: userId } }),
        db.unmatchedBlock.count({ where: { resolvedById: userId } }),
      ]);

    const footprint = audits + locks + imports + rates + deductions + extras + zeroPunch + unmatched;
    if (footprint > 0) {
      return {
        error:
          `${target.name} has ${footprint} record(s) of work on file (audit entries, approvals, imports). ` +
          'Deleting the account would blank the "who" on that history. Disable the account instead — ' +
          'it stops them signing in and keeps the trail intact.',
      };
    }

    await db.user.delete({ where: { id: userId } });

    await recordAudit({
      userId: admin.id,
      action: 'FIELD_UPDATE',
      entityType: 'User',
      entityId: userId,
      field: 'deleted',
      oldValue: `${target.name} <${target.email}> (${target.role})`,
      newValue: null,
      note: 'Account deleted - it had no recorded activity',
    });

    revalidatePath('/settings');
    return ok(`${target.name} deleted.`);
  } catch (error) {
    return fail(error);
  }
}
