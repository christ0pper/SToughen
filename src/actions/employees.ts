'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { fail, ok, type ActionState } from '@/lib/actionResult';
import { recordAudit, recordFieldChanges } from '@/lib/audit';
import { requireAdmin, requireUser } from '@/lib/auth';
import { isoDate } from '@/domain/time';
import { calculatePeriod } from '@/services/payrollService';
import { assertPeriodEditable } from '@/services/periodService';

const text = (formData: FormData, key: string): string | null => {
  const value = String(formData.get(key) ?? '').trim();
  return value === '' ? null : value;
};

export async function createEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();

    const name = text(formData, 'name');
    const joiningRaw = text(formData, 'joiningDate');
    const scheduleType = String(formData.get('scheduleType') ?? 'PS');

    if (!name) return { error: 'Enter the employee name.' };

    const deviceId = text(formData, 'deviceId');
    if (deviceId) {
      const clash = await db.employee.findUnique({ where: { deviceId } });
      if (clash) return { error: `Device ID ${deviceId} already belongs to ${clash.name}.` };
    }

    const count = await db.employee.count();
    const employee = await db.employee.create({
      data: {
        employeeCode: `EMP-${String(count + 1).padStart(4, '0')}`,
        name,
        deviceId,
        joiningDate: joiningRaw ? new Date(joiningRaw) : null,
        scheduleType,
        exceptionRole: scheduleType === 'EXCEPTION' ? String(formData.get('exceptionRole') ?? 'MANAGER') : null,
        address: text(formData, 'address'),
        contactNumber: text(formData, 'contactNumber'),
        position: text(formData, 'position'),
        esiApplicable: formData.get('esiApplicable') === 'on',
        pfApplicable: formData.get('pfApplicable') === 'on',
      },
    });

    // The opening pay is Admin-only data, so it is only accepted from an Admin.
    const pay = user.role === 'ADMIN' ? readPay(formData) : null;
    if (pay && 'error' in pay) {
      // The employee exists now; say what is wrong with the pay rather than
      // failing the whole form and making them type the person in again.
      revalidatePath('/employees');
      return { error: `Employee created, but their pay was not saved: ${pay.error} Add it on their Rates tab.` };
    }
    if (pay) {
      await db.employeeRate.create({
        data: {
          employeeId: employee.id,
          payBasis: pay.payBasis,
          hourlyRate: pay.hourlyRate,
          monthlySalary: pay.monthlySalary,
          // A rate has to start somewhere. Their first day if we know it,
          // otherwise today - backdating to a date nobody supplied would
          // silently change what past periods recalculate to.
          effectiveFrom: joiningRaw ? new Date(joiningRaw) : new Date(),
          note: 'Opening pay',
          createdById: user.id,
        },
      });
    }

    await recordAudit({
      userId: user.id,
      action: 'EMPLOYEE_CREATE',
      entityType: 'Employee',
      entityId: employee.id,
      newValue: { name, employeeCode: employee.employeeCode, scheduleType },
    });

    revalidatePath('/employees');
    const payOffered = Boolean(String(formData.get('payAmount') ?? formData.get('hourlyRate') ?? '').trim());
    return ok(
      payOffered && user.role !== 'ADMIN'
        ? `${name} created. The pay was ignored — only an Admin can set it.`
        : `${name} created as ${employee.employeeCode}.`,
    );
  } catch (error) {
    return fail(error);
  }
}

export async function updateEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const employeeId = String(formData.get('employeeId'));
    const before = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });

    const scheduleType = String(formData.get('scheduleType') ?? before.scheduleType);

    // Joining date drives holiday-pay eligibility, so it has to stay correctable
    // - including back to blank, for a record that was created without one.
    const joiningRaw = text(formData, 'joiningDate');

    const employeeCode = text(formData, 'employeeCode') ?? before.employeeCode;
    if (employeeCode !== before.employeeCode) {
      const clash = await db.employee.findUnique({ where: { employeeCode } });
      if (clash && clash.id !== employeeId) {
        return { error: `Employee code ${employeeCode} is already in use.` };
      }
    }

    const update: Record<string, unknown> = {
      name: text(formData, 'name') ?? before.name,
      employeeCode,
      joiningDate: joiningRaw ? new Date(joiningRaw) : null,
      deviceId: text(formData, 'deviceId'),
      address: text(formData, 'address'),
      contactNumber: text(formData, 'contactNumber'),
      position: text(formData, 'position'),
      scheduleType,
      exceptionRole: scheduleType === 'EXCEPTION' ? String(formData.get('exceptionRole') ?? 'MANAGER') : null,
      esiApplicable: formData.get('esiApplicable') === 'on',
      pfApplicable: formData.get('pfApplicable') === 'on',
      status: String(formData.get('status') ?? before.status),
    };

    // Bank details are viewable by HR/Accountant but editable only by Admin.
    if (user.role === 'ADMIN') {
      update.bankName = text(formData, 'bankName');
      update.bankAccountNumber = text(formData, 'bankAccountNumber');
      update.bankIfsc = text(formData, 'bankIfsc');
    }

    if (update.deviceId && update.deviceId !== before.deviceId) {
      const clash = await db.employee.findUnique({ where: { deviceId: String(update.deviceId) } });
      if (clash && clash.id !== employeeId) {
        return { error: `Device ID ${update.deviceId} already belongs to ${clash.name}.` };
      }
    }

    await db.employee.update({ where: { id: employeeId }, data: update });

    await recordFieldChanges(
      { userId: user.id, entityType: 'Employee', entityId: employeeId },
      before as unknown as Record<string, unknown>,
      update,
    );

    revalidatePath('/employees');
    revalidatePath(`/employees/${employeeId}`);
    return ok(
      user.role === 'ADMIN'
        ? 'Employee updated. Recalculate any draft period if the joining date or schedule changed.'
        : 'Employee updated. Hourly rate and bank details are Admin-only and were left unchanged.',
    );
  } catch (error) {
    return fail(error);
  }
}

/**
 * Reads a pay entry from a form: an hourly rate or a fixed monthly salary.
 *
 * The two forms that take pay (add employee, add rate) share this so they agree
 * on what is valid. A monthly salary under 1,000 or an hourly rate over 10,000 is
 * almost certainly the wrong box - the rate sheet this was built against had
 * monthly salaries typed into its hourly column - so both are refused with a
 * sentence saying which box was probably meant.
 */
function readPay(formData: FormData):
  | { payBasis: 'HOURLY' | 'MONTHLY'; hourlyRate: number; monthlySalary: number | null }
  | { error: string }
  | null {
  const raw = String(formData.get('payAmount') ?? formData.get('hourlyRate') ?? '').trim();
  if (!raw) return null;

  const payBasis = String(formData.get('payBasis') ?? 'HOURLY') === 'MONTHLY' ? 'MONTHLY' : 'HOURLY';
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: payBasis === 'MONTHLY' ? 'Enter a valid monthly salary.' : 'Enter a valid hourly rate.' };
  }

  if (payBasis === 'HOURLY' && amount > 10000) {
    return {
      error: `${amount.toLocaleString('en-IN')} an hour is about ${Math.round(amount * 208).toLocaleString('en-IN')} a month. If this is a monthly salary, choose "Monthly salary".`,
    };
  }
  if (payBasis === 'MONTHLY' && amount < 1000) {
    return {
      error: `${amount} a month looks like an hourly rate. If it is, choose "Hourly".`,
    };
  }

  return payBasis === 'MONTHLY'
    ? { payBasis, hourlyRate: 0, monthlySalary: amount }
    : { payBasis, hourlyRate: amount, monthlySalary: null };
}

/** How a pay entry reads in the audit trail. */
function payText(entry: { payBasis: string; hourlyRate: number; monthlySalary: number | null }): string {
  return entry.payBasis === 'MONTHLY'
    ? `${entry.monthlySalary} a month`
    : `${entry.hourlyRate} an hour`;
}

export async function addRateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireAdmin();
    const employeeId = String(formData.get('employeeId'));
    const effectiveRaw = String(formData.get('effectiveFrom') ?? '').trim();

    const pay = readPay(formData);
    if (!pay) return { error: 'Enter the hourly rate or monthly salary.' };
    if ('error' in pay) return { error: pay.error };
    if (!effectiveRaw) return { error: 'Enter the date this takes effect.' };

    const effectiveFrom = new Date(effectiveRaw);

    const existing = await db.employeeRate.findUnique({
      where: { employeeId_effectiveFrom: { employeeId, effectiveFrom } },
    });
    if (existing) return { error: 'A rate already starts on that date. Choose another date.' };

    await db.employeeRate.create({
      data: {
        employeeId,
        payBasis: pay.payBasis,
        hourlyRate: pay.hourlyRate,
        monthlySalary: pay.monthlySalary,
        effectiveFrom,
        note: String(formData.get('note') ?? '').trim() || null,
        createdById: user.id,
      },
    });

    await recordAudit({
      userId: user.id,
      action: 'RATE_CHANGE',
      entityType: 'Employee',
      entityId: employeeId,
      field: 'pay',
      newValue: `${payText(pay)} from ${effectiveRaw}`,
    });

    revalidatePath('/employees');
    return ok(
      pay.payBasis === 'MONTHLY'
        ? 'Monthly salary added. Recalculate any draft period it covers; earlier periods keep the pay in force at the time.'
        : 'Hourly rate added. Recalculate any draft period it covers; earlier periods keep the pay in force at the time.',
    );
  } catch (error) {
    return fail(error);
  }
}

export async function addDeductionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const employeeId = String(formData.get('employeeId'));
    const kind = String(formData.get('kind'));
    const amount = Number(formData.get('amount'));
    const reason = String(formData.get('reason') ?? '').trim();

    if (!['ONE_OFF', 'RECURRING'].includes(kind)) return { error: 'Choose a deduction type.' };
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter an amount above zero.' };
    if (!reason) return { error: 'A reason is required.' };

    const periodId = String(formData.get('periodId') ?? '').trim() || null;
    if (kind === 'ONE_OFF' && !periodId) return { error: 'Choose the period this one-off applies to.' };

    const startRaw = String(formData.get('startDate') ?? '').trim();

    await db.deduction.create({
      data: {
        employeeId,
        kind,
        amount,
        reason,
        periodId: kind === 'ONE_OFF' ? periodId : null,
        startDate: kind === 'RECURRING' ? (startRaw ? new Date(startRaw) : new Date()) : null,
      },
    });

    await recordAudit({
      userId: user.id,
      action: 'DEDUCTION_CREATE',
      entityType: 'Employee',
      entityId: employeeId,
      periodId,
      newValue: { kind, amount, reason },
    });

    revalidatePath('/employees');
    return ok('Deduction added.');
  } catch (error) {
    return fail(error);
  }
}

export async function stopDeductionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const deductionId = String(formData.get('deductionId'));
    const deduction = await db.deduction.findUniqueOrThrow({ where: { id: deductionId } });

    await db.deduction.update({
      where: { id: deductionId },
      data: { active: false, endDate: new Date() },
    });

    await recordAudit({
      userId: user.id,
      action: 'DEDUCTION_STOP',
      entityType: 'Deduction',
      entityId: deductionId,
      oldValue: 'active',
      newValue: 'stopped',
      note: deduction.reason,
    });

    revalidatePath('/employees');
    return ok('Deduction stopped. Past periods are unaffected.');
  } catch (error) {
    return fail(error);
  }
}

export async function addExtraAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const employeeId = String(formData.get('employeeId'));
    const periodId = String(formData.get('periodId') ?? '').trim();
    const amount = Number(formData.get('amount'));
    const reason = String(formData.get('reason') ?? '').trim();

    if (!periodId) return { error: 'Choose the period.' };
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter an amount above zero.' };
    if (!reason) return { error: 'A reason is required.' };

    await db.extraBonus.create({
      data: { employeeId, periodId, amount, reason, createdById: user.id },
    });

    await recordAudit({
      userId: user.id,
      action: 'EXTRA_CREATE',
      entityType: 'Employee',
      entityId: employeeId,
      periodId,
      newValue: { amount, reason },
    });

    revalidatePath('/employees');
    return ok('Extra/bonus added.');
  } catch (error) {
    return fail(error);
  }
}

/**
 * Permanently remove an employee.
 *
 * Refused once they appear in any payroll period. Spec 21 requires historical
 * payroll and attendance data to be retained indefinitely, and deleting the
 * employee would cascade their whole history away with them. "Left / inactive"
 * is the answer for someone who has left - it takes them out of every future
 * run while keeping the record. Deletion is only for a row created in error.
 */
export async function deleteEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const employeeId = String(formData.get('employeeId'));
    const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });

    const [lines, days] = await Promise.all([
      db.payrollLine.count({ where: { employeeId } }),
      db.attendanceDay.count({ where: { employeeId } }),
    ]);

    if (lines > 0 || days > 0) {
      return {
        error:
          `${employee.name} already appears in payroll (${lines} calculated period(s), ${days} attendance day(s)). ` +
          'Deleting them would take that history with them, which payroll records must keep. ' +
          'Set their status to "Left / inactive" instead - they drop out of future runs and the history stays.',
      };
    }

    await db.employee.delete({ where: { id: employeeId } });

    await recordAudit({
      userId: admin.id,
      action: 'FIELD_UPDATE',
      entityType: 'Employee',
      entityId: employeeId,
      field: 'deleted',
      oldValue: `${employee.name} (${employee.employeeCode})`,
      newValue: null,
      note: 'Employee deleted - they had no payroll history',
    });

    revalidatePath('/employees');
    return ok(`${employee.name} deleted.`);
  } catch (error) {
    return fail(error);
  }
}

/** Remove a rate row entered by mistake. The history is append-only otherwise. */
export async function deleteRateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const rateId = String(formData.get('rateId'));
    const rate = await db.employeeRate.findUniqueOrThrow({ where: { id: rateId } });

    const remaining = await db.employeeRate.count({ where: { employeeId: rate.employeeId } });
    if (remaining <= 1) {
      return { error: 'That is the only rate on record. Add the correct one first, then remove this.' };
    }

    await db.employeeRate.delete({ where: { id: rateId } });

    await recordAudit({
      userId: admin.id,
      action: 'RATE_CHANGE',
      entityType: 'Employee',
      entityId: rate.employeeId,
      field: 'pay',
      oldValue: `${payText(rate)} from ${isoDate(rate.effectiveFrom)}`,
      newValue: null,
      note: 'Rate row removed. Recalculate any draft period it affected.',
    });

    revalidatePath(`/employees/${rate.employeeId}`);
    return ok('Rate removed. Recalculate any draft period it affected.');
  } catch (error) {
    return fail(error);
  }
}

export async function deleteDeductionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const deductionId = String(formData.get('deductionId'));
    const deduction = await db.deduction.findUniqueOrThrow({ where: { id: deductionId } });

    if (deduction.periodId) await assertPeriodEditable(deduction.periodId);
    await db.deduction.delete({ where: { id: deductionId } });

    await recordAudit({
      userId: user.id,
      action: 'DEDUCTION_STOP',
      entityType: 'Employee',
      entityId: deduction.employeeId,
      periodId: deduction.periodId,
      field: 'deduction',
      oldValue: `${deduction.amount} - ${deduction.reason}`,
      newValue: null,
      note: 'Deduction deleted',
    });

    if (deduction.periodId) await calculatePeriod(deduction.periodId, user.id);
    revalidatePath(`/employees/${deduction.employeeId}`);
    return ok('Deduction removed.');
  } catch (error) {
    return fail(error);
  }
}

export async function deleteExtraAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const extraId = String(formData.get('extraId'));
    const extra = await db.extraBonus.findUniqueOrThrow({ where: { id: extraId } });

    await assertPeriodEditable(extra.periodId);
    await db.extraBonus.delete({ where: { id: extraId } });

    await recordAudit({
      userId: user.id,
      action: 'EXTRA_CREATE',
      entityType: 'Employee',
      entityId: extra.employeeId,
      periodId: extra.periodId,
      field: 'extra',
      oldValue: `${extra.amount} - ${extra.reason}`,
      newValue: null,
      note: 'Extra/bonus deleted',
    });

    await calculatePeriod(extra.periodId, user.id);
    revalidatePath(`/employees/${extra.employeeId}`);
    return ok('Extra removed.');
  } catch (error) {
    return fail(error);
  }
}
