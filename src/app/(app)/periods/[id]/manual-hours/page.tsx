import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { daysInMonth, makeDate } from '@/domain/time';
import { hours, periodLabel, rupees } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { saveManualHoursAction } from '@/actions/periods';

export const dynamic = 'force-dynamic';

const WEEKDAY = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'];

export default async function ManualHoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const period = await db.payrollPeriod.findUnique({ where: { id } });
  if (!period) notFound();

  const locked = period.status === 'LOCKED';
  const lastDay = daysInMonth(period.year, period.month);
  const days = Array.from({ length: lastDay }, (_, index) => {
    const dayOfMonth = index + 1;
    const date = makeDate(period.year, period.month, dayOfMonth);
    return { dayOfMonth, date, isSunday: date.getDay() === 0 };
  });

  const employees = await db.employee.findMany({
    where: { scheduleType: 'EXCEPTION', status: { not: 'INACTIVE' } },
    orderBy: { name: 'asc' },
    include: {
      attendanceDays: { where: { periodId: id }, orderBy: { dayOfMonth: 'asc' } },
      payrollLines: { where: { periodId: id } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/periods/${id}`} className="text-xs text-ink-soft hover:underline">
          ← {periodLabel(period.year, period.month)}
        </Link>
        <h1 className="page-title mt-1">Exception-role hours</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Salesmen, managers, security and drivers are paid on hours entered here. Any punch data the
          device recorded for them is ignored, and no break deduction, punctuality or merit bonus
          applies. Sundays are left blank by a bulk fill.
        </p>
      </div>

      {employees.length === 0 ? (
        <section className="card p-6 text-sm text-ink-soft">
          No exception-role employees. Set an employee&apos;s schedule to “Exception role” to list them here.
        </section>
      ) : (
        employees.map((employee) => {
          const byDay = new Map(employee.attendanceDays.map((row) => [row.dayOfMonth, row]));
          const line = employee.payrollLines[0];

          return (
            <section key={employee.id} className="card">
              <div className="card-head">
                <h2 className="card-title">
                  {employee.name}
                  <span className="ml-2 text-xs font-normal text-ink-soft">
                    {employee.employeeCode} · {employee.exceptionRole}
                  </span>
                </h2>
                <span className="text-xs text-ink-soft">
                  {line
                    ? `${hours(line.payableHours)} h · ${rupees(line.finalPay)} final`
                    : 'not calculated yet'}
                </span>
              </div>

              <div className="px-5 pb-5">
                <ActionForm
                  action={saveManualHoursAction}
                  hidden={{ periodId: id, employeeId: employee.id }}
                  submitLabel="Save hours"
                  variant="primary"
                >
                  <fieldset disabled={locked}>
                    <div className="mb-3 flex flex-wrap items-end gap-3">
                      <div className="w-56">
                        <label className="label">Fill empty working days with</label>
                        <input
                          name="fillAll"
                          type="number"
                          step="0.25"
                          min="0"
                          max="24"
                          className="input"
                          placeholder="e.g. 8 — leaves Sundays blank"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-11">
                      {days.map((day) => {
                        const row = byDay.get(day.dayOfMonth);
                        const value =
                          row?.manualWorkedMinutes == null ? '' : row.manualWorkedMinutes / 60;
                        return (
                          <div key={day.dayOfMonth}>
                            <label
                              className={`label ${day.isSunday ? 'text-ink-muted' : ''}`}
                              htmlFor={`${employee.id}-day-${day.dayOfMonth}`}
                            >
                              {day.dayOfMonth} {WEEKDAY[day.date.getDay()]}
                            </label>
                            <input
                              id={`${employee.id}-day-${day.dayOfMonth}`}
                              name={`day-${day.dayOfMonth}`}
                              type="number"
                              step="0.25"
                              min="0"
                              max="24"
                              className={`input px-1.5 text-center ${day.isSunday ? 'bg-thead' : ''}`}
                              defaultValue={value}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </fieldset>
                </ActionForm>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
