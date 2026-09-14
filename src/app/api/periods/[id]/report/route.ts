import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildSummaryWorkbook } from '@/lib/exportExcel';
import { getSummaryRows } from '@/services/reportService';

export const dynamic = 'force-dynamic';

/** All-employee summary report as .xlsx. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return new Response('Unauthorised', { status: 401 });

  const { id } = await context.params;
  const period = await db.payrollPeriod.findUnique({ where: { id } });
  if (!period) return new Response('Not found', { status: 404 });

  const rows = await getSummaryRows(id);
  const workbook = buildSummaryWorkbook(rows, period);

  const name = `payroll-summary-${period.year}-${String(period.month).padStart(2, '0')}.xlsx`;

  return new Response(workbook as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
