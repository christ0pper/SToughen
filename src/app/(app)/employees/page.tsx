import { db } from '@/lib/db';
import { getSession, isAdmin } from '@/lib/auth';
import { resolveRate } from '@/domain/pay';
import { toRateHistory } from '@/services/payrollService';
import { payLabel, scheduleHours, scheduleName, shortDate } from '@/lib/format';
import { AddEmployeeDialog } from '@/components/employees/AddEmployeeDialog';
import { EmployeeDirectory } from '@/components/employees/EmployeeDirectory';

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

  // Formatted here, so the table below stays a dumb list that a filter can run
  // over in the browser.
  const rows = employees.map((employee) => {
    const pay = resolveRate(toRateHistory(employee.rates), today);
    return {
      id: employee.id,
      name: employee.name,
      employeeCode: employee.employeeCode,
      deviceId: employee.deviceId,
      scheduleName: scheduleName(employee.scheduleType, employee.exceptionRole),
      scheduleHours: scheduleHours(employee.scheduleType),
      joined: employee.joiningDate ? shortDate(employee.joiningDate) : null,
      pay: pay == null ? null : payLabel(pay),
      statutory: `${employee.esiApplicable ? 'ESI' : '—'} / ${employee.pfApplicable ? 'PF' : '—'}`,
      status: employee.status,
      statusLabel: STATUS_LABELS[employee.status] ?? employee.status,
      statusStyle: STATUS_STYLES[employee.status] ?? '',
    };
  });

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

      <EmployeeDirectory rows={rows} />

    </div>
  );
}
