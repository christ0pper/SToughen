import { EmployeeDetail } from '@/components/employees/EmployeeDetail';

export const dynamic = 'force-dynamic';

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeDetail id={id} />;
}
