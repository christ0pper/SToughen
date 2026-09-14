import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildPayslipPdf } from '@/lib/exportPdf';
import { getPayslipData, type PayslipData } from '@/services/reportService';

export const dynamic = 'force-dynamic';

/**
 * Payslips as PDF — one page per employee.
 * Pass ?employeeId=... for a single payslip, otherwise everyone in the run.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return new Response('Unauthorised', { status: 401 });

  const { id } = await context.params;
  const period = await db.payrollPeriod.findUnique({ where: { id } });
  if (!period) return new Response('Not found', { status: 404 });

  const employeeId = new URL(request.url).searchParams.get('employeeId');

  const lines = await db.payrollLine.findMany({
    where: employeeId ? { periodId: id, employeeId } : { periodId: id, inPayroll: true },
    include: { employee: { select: { name: true } } },
    orderBy: { employee: { name: 'asc' } },
  });

  if (lines.length === 0) {
    return new Response('Nothing has been calculated for this period yet.', { status: 404 });
  }

  const payslips: PayslipData[] = [];
  for (const line of lines) {
    const data = await getPayslipData(id, line.employeeId);
    if (data) payslips.push(data);
  }

  let pdf: Buffer;
  try {
    pdf = await buildPayslipPdf(payslips);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF generation failed.';
    return new Response(message, { status: 500 });
  }

  const suffix = employeeId ? `-${payslips[0]?.employee.employeeCode ?? employeeId}` : '';
  const name = `payslips-${period.year}-${String(period.month).padStart(2, '0')}${suffix}.pdf`;

  return new Response(new Uint8Array(pdf) as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
