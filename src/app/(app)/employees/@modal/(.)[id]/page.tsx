import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { shortDate } from '@/lib/format';
import { EmployeeDetail } from '@/components/employees/EmployeeDetail';
import { EmployeeDetailModal } from '@/components/employees/EmployeeDetailModal';

export const dynamic = 'force-dynamic';

/**
 * Intercepts /employees/[id] when it is opened from the directory, so a member
 * appears in a dialog over the list instead of replacing it. A hard load of the
 * same URL skips this file and renders the full page.
 */
export default async function EmployeeModalRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const employee = await db.employee.findUnique({
    where: { id },
    select: { name: true, employeeCode: true, joiningDate: true, deviceId: true },
  });
  if (!employee) notFound();

  const device = employee.deviceId ? `device ${employee.deviceId}` : 'no device ID linked';

  return (
    <EmployeeDetailModal
      title={employee.name}
      description={`${employee.employeeCode} · joined ${shortDate(employee.joiningDate)} · ${device}`}
    >
      <EmployeeDetail id={id} variant="modal" />
    </EmployeeDetailModal>
  );
}
