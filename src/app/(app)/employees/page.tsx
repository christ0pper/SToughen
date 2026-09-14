import Link from 'next/link';
import { db } from '@/lib/db';
import { getSession, isAdmin } from '@/lib/auth';
import { resolveRate } from '@/domain/pay';
import { toRateHistory } from '@/services/payrollService';
import { payLabel, scheduleHours, scheduleName, shortDate } from '@/lib/format';
import { AddEmployeeDialog } from '@/components/employees/AddEmployeeDialog';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'pill-good',
  INACTIVE: 'pill-neutral',
  ON_EXTENDED_LEAVE: 'pill-warn',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Left',
  ON_EXTENDED_LEAVE: 'Extended leave',
};

export default async function EmployeesPage() {
  const user = await getSession();
  const admin = isAdmin(user);

  const employees = await db.employee.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: { rates: { orderBy: { effectiveFrom: 'asc' } } },
  });

  const today = new Date();
  const active = employees.filter((employee) => employee.status === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {employees.length} on record · {active} active. Device ID is what matches each person
            to the monthly file.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <AddEmployeeDialog admin={admin} />
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="card-title">Directory</h2>
          <span className="card-note">open anyone to see their full record</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Device ID</th>
                <th>Schedule</th>
                <th>Joined</th>
                <th className="num">Current pay</th>
                <th>ESI / PF</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center">
                    <p className="text-sm font-medium text-ink">Nobody on record yet</p>
                    <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-soft">
                      Add your staff here with the Device ID the biometric machine knows them by.
                      Anyone the first export finds who is not on this list lands in the unmatched
                      queue instead, where you can create them from the punch data.
                    </p>
                  </td>
                </tr>
              ) : null}
              {employees.map((employee) => {
                const pay = resolveRate(toRateHistory(employee.rates), today);
                return (
                  <tr key={employee.id}>
                    <td>
                      <Link
                        className="font-medium text-ink hover:text-brand hover:underline"
                        href={`/employees/${employee.id}`}
                      >
                        {employee.name}
                      </Link>
                    </td>
                    <td className="text-xs text-ink-muted">{employee.employeeCode}</td>
                    <td className="tabular-nums">
                      {employee.deviceId ?? <span className="text-amber-600">not linked</span>}
                    </td>
                    <td>
                      <span className="block">
                        {scheduleName(employee.scheduleType, employee.exceptionRole)}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {scheduleHours(employee.scheduleType)}
                      </span>
                    </td>
                    <td className="text-xs">
                      {employee.joiningDate ? (
                        shortDate(employee.joiningDate)
                      ) : (
                        <span className="text-warn-ink">not set</span>
                      )}
                    </td>
                    <td className="num">
                      {pay == null ? <span className="text-amber-600">not set</span> : payLabel(pay)}
                    </td>
                    <td className="text-xs">
                      {employee.esiApplicable ? 'ESI' : '—'} / {employee.pfApplicable ? 'PF' : '—'}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_STYLES[employee.status] ?? ''}`}>
                        {STATUS_LABELS[employee.status] ?? employee.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <Link className="btn" href={`/employees/${employee.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
