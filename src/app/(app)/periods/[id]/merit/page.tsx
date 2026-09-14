import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { PAY_RULES } from '@/domain/config';
import { daysInMonth, makeDate } from '@/domain/time';
import { periodLabel, rupees } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { saveMeritAction } from '@/actions/periods';

export const dynamic = 'force-dynamic';

const WEEKDAY = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'];

export default async function MeritPage({ params }: { params: Promise<{ id: string }> }) {
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

  const excluded = new Set(
    (
      await db.zeroPunchReview.findMany({
        where: { periodId: id, decision: { in: ['LEFT_INACTIVE', 'EXTENDED_LEAVE'] } },
        select: { employeeId: true },
      })
    ).map((row) => row.employeeId),
  );

  const employees = (
    await db.employee.findMany({
      where: { scheduleType: { not: 'EXCEPTION' }, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      include: {
        attendanceDays: { where: { periodId: id }, orderBy: { dayOfMonth: 'asc' } },
        payrollLines: { where: { periodId: id } },
      },
    })
  ).filter((employee) => !excluded.has(employee.id));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/periods/${id}`} className="text-xs text-ink-soft hover:underline">
          ← {periodLabel(period.year, period.month)}
        </Link>
        <h1 className="page-title mt-1">Merit days</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Tick the days that earn the merit bonus — safety equipment worn, no incidents, whatever the
          owner is rewarding. Each ticked day pays ₹{PAY_RULES.meritRatePerHour} per hour actually
          worked that day, so an absent day ticked here still pays nothing. Exception roles do not
          qualify.
        </p>
      </div>

      {employees.map((employee) => {
        const byDay = new Map(employee.attendanceDays.map((row) => [row.dayOfMonth, row]));
        const line = employee.payrollLines[0];

        return (
          <section key={employee.id} className="card">
            <div className="card-head">
              <h2 className="card-title">
                {employee.name}
                <span className="ml-2 text-xs font-normal text-ink-soft">
                  {employee.employeeCode} · {employee.scheduleType}
                </span>
              </h2>
              <span className="text-xs text-ink-soft">
                {line ? `${line.daysMerit} day(s) · ${rupees(line.meritPay)}` : 'not calculated yet'}
              </span>
            </div>

            <div className="px-5 pb-5">
              <ActionForm
                action={saveMeritAction}
                hidden={{ periodId: id, employeeId: employee.id }}
                submitLabel="Save merit days"
                variant="primary"
              >
                <fieldset disabled={locked}>
                  <label className="mb-3 flex items-center gap-2 text-sm text-ink-soft">
                    <input type="checkbox" name="tickAll" />
                    Tick every working day (overrides the boxes below)
                  </label>

                  <div className="grid grid-cols-4 gap-x-3 gap-y-1.5 sm:grid-cols-8 lg:grid-cols-11">
                    {days.map((day) => {
                      const row = byDay.get(day.dayOfMonth);
                      return (
                        <label
                          key={day.dayOfMonth}
                          className={`flex items-center gap-1.5 text-xs ${
                            day.isSunday ? 'text-ink-muted' : 'text-ink-soft'
                          }`}
                        >
                          <input
                            type="checkbox"
                            name={`merit-${day.dayOfMonth}`}
                            defaultChecked={row?.meritTicked ?? false}
                          />
                          {day.dayOfMonth} {WEEKDAY[day.date.getDay()]}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </ActionForm>
            </div>
          </section>
        );
      })}
    </div>
  );
}
