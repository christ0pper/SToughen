import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSession, isAdmin } from '@/lib/auth';
import { isoDate } from '@/domain/time';
import { resolveRate } from '@/domain/pay';
import {
  hours as formatHours,
  initialsOf,
  payLabel,
  periodLabel,
  rupees,
  scheduleHours,
  scheduleName,
  shortDate,
} from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { Tabs } from '@/components/Tabs';
import { PagedTable } from '@/components/PagedTable';
import { BarBreakdown } from '@/components/panels/BarBreakdown';
import { ProfileRail } from '@/components/panels/ProfileRail';
import { StatStrip } from '@/components/panels/StatStrip';
import { EmployeeMasterData } from '@/components/employees/EmployeeMasterData';
import { PayInput } from '@/components/employees/PayInput';
import { toRateHistory } from '@/services/payrollService';
import { punctualityRate } from '@/services/analyticsService';
import {
  BankIcon,
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  PhoneIcon,
  WalletIcon,
} from '@/components/Icons';
import {
  addDeductionAction,
  addExtraAction,
  addRateAction,
  deleteDeductionAction,
  deleteEmployeeAction,
  deleteExtraAction,
  deleteRateAction,
  stopDeductionAction,
} from '@/actions/employees';

export interface EmployeeDetailProps {
  id: string;
  /** 'modal' drops the page heading, which the dialog's own title bar supplies. */
  variant?: 'page' | 'modal';
}

/**
 * Everything on record for one employee.
 *
 * A fixed identity rail on the left and tabbed detail on the right, after the
 * source design: who this is stays on screen while what you are looking at
 * changes, because every tab is read against that context. The same component
 * renders in the directory's dialog and at /employees/[id], so a popup and a
 * bookmarked link can never drift apart.
 */
export async function EmployeeDetail({ id, variant = 'page' }: EmployeeDetailProps) {
  const user = await getSession();
  const admin = isAdmin(user);

  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      rates: { orderBy: { effectiveFrom: 'desc' }, include: { createdBy: { select: { name: true } } } },
      deductions: { orderBy: { createdAt: 'desc' }, include: { period: true } },
      extras: { orderBy: { createdAt: 'desc' }, include: { period: true } },
      payrollLines: { orderBy: { period: { year: 'desc' } }, include: { period: true } },
    },
  });
  if (!employee) notFound();

  const draftPeriods = await db.payrollPeriod.findMany({
    where: { status: 'DRAFT' },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  const isExceptionRole = employee.scheduleType === 'EXCEPTION';

  // Totals across every period on record.
  const paid = employee.payrollLines.filter((line) => line.inPayroll);
  const sum = (pick: (line: (typeof paid)[number]) => number) =>
    paid.reduce((total, line) => total + pick(line), 0);

  const totalHours = sum((l) => l.payableHours);
  const totalDays = sum((l) => l.daysPresent);
  const punctualDays = sum((l) => l.daysPunctual);
  const totals = {
    periods: paid.length,
    hours: totalHours,
    days: totalDays,
    avgHoursPerDay: totalDays > 0 ? totalHours / totalDays : null,
    overtimeHours: sum((l) => l.overtimeHours),
    absentDays: sum((l) => l.daysAbsent),
    leaveDays: sum(
      (l) =>
        l.daysSanctionedLeave + l.daysUnauthorisedAbsence + l.daysHalfDay + l.daysOtherResolution,
    ),
    gross: sum((l) => l.grossPay),
    deductions: sum((l) => l.deductionTotal),
    payout: sum((l) => l.finalPay),
    punctuality: isExceptionRole ? null : punctualityRate(punctualDays, totalDays),
  };

  // The pay in force today, of either kind.
  const currentPay = resolveRate(toRateHistory(employee.rates), new Date());
  const salaried = currentPay?.payBasis === 'MONTHLY';

  // Exception roles have no punch discipline to measure, so the bars drop the
  // punctuality split rather than showing it as a truthful-looking zero.
  const bars = [
    { value: totals.days, display: `${totals.days} days`, caption: 'Worked' },
    ...(isExceptionRole
      ? []
      : [{ value: punctualDays, display: `${punctualDays} days`, caption: 'Punctual' }]),
    { value: totals.leaveDays, display: `${totals.leaveDays} days`, caption: 'Leave' },
    { value: totals.absentDays, display: `${totals.absentDays} days`, caption: 'Absent' },
  ];

  const strip = [
    { value: formatHours(totals.hours), caption: 'Total payable hours' },
    { value: formatHours(totals.overtimeHours), caption: 'Overtime hours' },
    {
      value: totals.punctuality == null ? '—' : `${totals.punctuality.toFixed(0)}%`,
      caption: isExceptionRole ? 'Punctuality (not measured)' : 'Punctuality rate',
      tone: 'ink' as const,
    },
    {
      value: totals.avgHoursPerDay == null ? '—' : totals.avgHoursPerDay.toFixed(2),
      caption: 'Average hours per day',
    },
    { value: rupees(totals.payout), caption: 'Total paid out', tone: 'good' as const },
  ];

  const overview = (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">Attendance</h2>
        <span className="card-note">
          {totals.periods === 0
            ? 'no calculated periods yet'
            : `across ${totals.periods} period${totals.periods === 1 ? '' : 's'}`}
        </span>
      </div>
      {totals.periods === 0 ? (
        <p className="alert alert-info">
          Nothing to show until this employee appears in a calculated payroll period.
        </p>
      ) : (
        <>
          <BarBreakdown bars={bars} />
          <StatStrip cells={strip} />
        </>
      )}
    </div>
  );

  const masterData = (
    <div className="p-5">
      <EmployeeMasterData
        admin={admin}
        employee={{
          id: employee.id,
          name: employee.name,
          employeeCode: employee.employeeCode,
          deviceId: employee.deviceId,
          joiningDateIso: employee.joiningDate ? isoDate(employee.joiningDate) : '',
          joiningDateLabel: shortDate(employee.joiningDate),
          position: employee.position,
          status: employee.status,
          scheduleType: employee.scheduleType,
          scheduleLabel: scheduleName(employee.scheduleType, employee.exceptionRole),
          exceptionRole: employee.exceptionRole,
          esiApplicable: employee.esiApplicable,
          pfApplicable: employee.pfApplicable,
          contactNumber: employee.contactNumber,
          address: employee.address,
          bankName: employee.bankName,
          bankAccountNumber: employee.bankAccountNumber,
          bankIfsc: employee.bankIfsc,
        }}
      />

      {admin ? (
        <div className="mt-8 rounded-lg border border-red-200 p-4">
          <h3 className="text-sm font-semibold text-red-700">Remove this employee</h3>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-[13px] text-ink-soft">
              For someone who has actually left, set their status to{' '}
              <strong>Left / inactive</strong> above — they drop out of every future payroll run and
              their history stays intact. Deletion is only for a record created by mistake, and is
              refused once the employee appears in any payroll period.
            </p>
            <ActionForm
              action={deleteEmployeeAction}
              hidden={{ employeeId: employee.id }}
              submitLabel="Delete employee"
              variant="danger"
              confirm={`Permanently delete ${employee.name}? Refused if they have any payroll history.`}
            />
          </div>
        </div>
      ) : null}
    </div>
  );

  const payHistory = (
    <PagedTable
      columns={8}
      empty="No calculated periods yet."
      head={
        <tr>
          <th>Period</th>
          <th className="num">Hours</th>
          <th className="num">Days present</th>
          <th className="num">Punctual days</th>
          <th className="num">Gross</th>
          <th className="num">Deductions</th>
          <th className="num">Final</th>
          <th />
        </tr>
      }
      rows={employee.payrollLines.map((line) => (
        <tr key={line.id}>
          <td>
            <Link className="hover:underline" href={`/periods/${line.periodId}`}>
              {periodLabel(line.period.year, line.period.month)}
            </Link>
          </td>
          <td className="num">{line.payableHours.toFixed(2)}</td>
          <td className="num">{line.daysPresent}</td>
          <td className="num">{line.daysPunctual}</td>
          <td className="num">{rupees(line.grossPay)}</td>
          <td className="num">{rupees(line.deductionTotal)}</td>
          <td className="num font-semibold">{rupees(line.finalPay)}</td>
          <td className="text-right">
            <a
              className="btn"
              href={`/api/periods/${line.periodId}/payslips?employeeId=${employee.id}`}
            >
              Payslip
            </a>
          </td>
        </tr>
      ))}
    />
  );

  const rates = (
    <>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Effective from</th>
              <th>Paid</th>
              <th className="num">Amount</th>
              <th>Note</th>
              <th>Set by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {employee.rates.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-warn-ink">
                  No rate on record. Pay calculates as zero until an Admin sets one.
                </td>
              </tr>
            ) : (
              employee.rates.map((rate) => (
                <tr key={rate.id}>
                  <td>{shortDate(rate.effectiveFrom)}</td>
                  <td>
                    <span className={`pill ${rate.payBasis === 'MONTHLY' ? 'pill-soft-brand' : 'pill-neutral'}`}>
                      {rate.payBasis === 'MONTHLY' ? 'Monthly salary' : 'Hourly'}
                    </span>
                  </td>
                  <td className="num">{payLabel(rate)}</td>
                  <td className="text-xs text-ink-muted">{rate.note ?? '—'}</td>
                  <td className="text-xs text-ink-muted">{rate.createdBy?.name ?? '—'}</td>
                  <td className="text-right">
                    {admin && employee.rates.length > 1 ? (
                      <ActionForm
                        action={deleteRateAction}
                        hidden={{ rateId: rate.id }}
                        submitLabel="Remove"
                        confirm="Remove this rate? Recalculate any draft period it affected."
                      />
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {admin ? (
        <div className="border-t border-hairline px-5 py-4">
          <ActionForm
            action={addRateAction}
            hidden={{ employeeId: employee.id }}
            submitLabel="Add pay"
          >
            <div className="mb-3 grid gap-3 sm:grid-cols-4">
              <PayInput defaultBasis={salaried ? 'MONTHLY' : 'HOURLY'} required />
              <div>
                <label className="label">Effective from</label>
                <input name="effectiveFrom" type="date" className="input" required />
              </div>
              <div>
                <label className="label">Note</label>
                <input name="note" className="input" placeholder="Annual increment" />
              </div>
            </div>
          </ActionForm>
        </div>
      ) : (
        <p className="border-t border-hairline px-5 py-3 text-xs text-ink-muted">
          Only an Admin can change pay.
        </p>
      )}
    </>
  );

  const deductions = (
    <>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Amount</th>
              <th>Reason</th>
              <th>Applies to</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {employee.deductions.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-ink-muted">
                  None recorded.
                </td>
              </tr>
            ) : (
              employee.deductions.map((deduction) => (
                <tr key={deduction.id}>
                  <td>{deduction.kind === 'ONE_OFF' ? 'One-off' : 'Recurring'}</td>
                  <td className="num">{rupees(deduction.amount)}</td>
                  <td>{deduction.reason}</td>
                  <td className="text-xs text-ink-muted">
                    {deduction.period
                      ? periodLabel(deduction.period.year, deduction.period.month)
                      : deduction.startDate
                        ? `from ${shortDate(deduction.startDate)}`
                        : '—'}
                  </td>
                  <td>
                    <span className={`pill ${deduction.active ? 'pill-good' : 'pill-neutral'}`}>
                      {deduction.active ? 'Active' : 'Stopped'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-start justify-end gap-2">
                      {deduction.kind === 'RECURRING' && deduction.active ? (
                        <ActionForm
                          action={stopDeductionAction}
                          hidden={{ deductionId: deduction.id }}
                          submitLabel="Stop"
                          confirm="Stop this recurring deduction? Past periods are unaffected."
                        />
                      ) : null}
                      <ActionForm
                        action={deleteDeductionAction}
                        hidden={{ deductionId: deduction.id }}
                        submitLabel="Delete"
                        variant="danger"
                        confirm="Delete this deduction outright? Stopping it is usually the better record."
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-hairline px-5 py-4">
        <ActionForm
          action={addDeductionAction}
          hidden={{ employeeId: employee.id }}
          submitLabel="Add deduction"
        >
          <div className="mb-3 grid gap-3 sm:grid-cols-4">
            <div>
              <label className="label">Type</label>
              <select name="kind" className="input" defaultValue="ONE_OFF">
                <option value="ONE_OFF">One-off</option>
                <option value="RECURRING">Recurring</option>
              </select>
            </div>
            <div>
              <label className="label">Amount</label>
              <input name="amount" type="number" step="0.01" min="0" className="input" required />
            </div>
            <div>
              <label className="label">Reason</label>
              <input name="reason" className="input" required placeholder="Damages, rent…" />
            </div>
            <div>
              <label className="label">Period / start date</label>
              <select name="periodId" className="input" defaultValue="">
                <option value="">—</option>
                {draftPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {periodLabel(period.year, period.month)}
                  </option>
                ))}
              </select>
              <input name="startDate" type="date" className="input mt-1.5" />
            </div>
          </div>
        </ActionForm>
      </div>
    </>
  );

  const extras = (
    <>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Amount</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {employee.extras.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-ink-muted">
                  None recorded.
                </td>
              </tr>
            ) : (
              employee.extras.map((extra) => (
                <tr key={extra.id}>
                  <td>{periodLabel(extra.period.year, extra.period.month)}</td>
                  <td className="num">{rupees(extra.amount)}</td>
                  <td>{extra.reason}</td>
                  <td className="text-right">
                    <ActionForm
                      action={deleteExtraAction}
                      hidden={{ extraId: extra.id }}
                      submitLabel="Remove"
                      confirm="Remove this extra/bonus?"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-hairline px-5 py-4">
        <ActionForm
          action={addExtraAction}
          hidden={{ employeeId: employee.id }}
          submitLabel="Add extra"
        >
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Period</label>
              <select name="periodId" className="input" defaultValue="">
                <option value="">Choose…</option>
                {draftPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {periodLabel(period.year, period.month)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Amount</label>
              <input name="amount" type="number" step="0.01" min="0" className="input" required />
            </div>
            <div>
              <label className="label">Reason</label>
              <input name="reason" className="input" required placeholder="Festival bonus" />
            </div>
          </div>
        </ActionForm>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {variant === 'page' ? (
        <div>
          <Link href="/employees" className="text-xs text-ink-muted hover:text-ink">
            ← All employees
          </Link>
          <h1 className="page-title mt-1">{employee.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {employee.employeeCode} · joined {shortDate(employee.joiningDate)} ·{' '}
            {employee.deviceId ? `device ${employee.deviceId}` : 'no device ID linked'}
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <ProfileRail
          initials={initialsOf(employee.name)}
          name={employee.name}
          subtitle={employee.position ?? employee.employeeCode}
          info={[
            {
              icon: <BriefcaseIcon />,
              value: scheduleName(employee.scheduleType, employee.exceptionRole),
              caption: 'Schedule',
            },
            {
              icon: <WalletIcon className="h-4 w-4" />,
              value: currentPay == null ? 'Not set' : payLabel(currentPay),
              caption: salaried ? 'Fixed monthly salary' : 'Hourly rate',
              tone: currentPay == null ? 'ink' : 'good',
            },
            {
              icon: <ClockIcon className="h-4 w-4" />,
              value: scheduleHours(employee.scheduleType),
              caption: 'Work shift',
            },
            {
              icon: <CalendarIcon className="h-4 w-4" />,
              value: shortDate(employee.joiningDate),
              caption: 'Joining date',
            },
          ]}
          contact={[
            {
              icon: <PhoneIcon />,
              value: employee.contactNumber ?? '—',
              caption: 'Phone',
            },
            {
              icon: <MapPinIcon />,
              value: employee.address ?? '—',
              caption: 'Address',
            },
            {
              icon: <BankIcon />,
              value: employee.bankName ?? '—',
              caption: 'Bank',
            },
          ]}
        />

        <section className="card overflow-hidden">
          <Tabs
            barClassName="px-5 pt-1"
            panelClassName=""
            tabs={[
              { id: 'overview', label: 'Overview', content: overview },
              { id: 'pay', label: 'Pay history', content: payHistory },
              { id: 'rates', label: 'Rates', content: rates },
              { id: 'deductions', label: 'Deductions', content: deductions },
              { id: 'extras', label: 'Extra / bonus', content: extras },
              { id: 'master', label: 'Master data', content: masterData },
            ]}
          />
        </section>
      </div>
    </div>
  );
}
