import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { servePayrollHours } from '../../shared/payrollHoursRead.js';

export default async function(req: Request): Promise<Response> {
  try {
    return await servePayrollHours(createClientFromRequest(req), req);
  } catch (error) {
    const e = error as { status?: number; response?: { status?: number } };
    const status = e?.status || e?.response?.status;
    if (status === 401 || status === 403) return Response.json({ error: 'אין הרשאה לדוח שעות לשכר' }, { status });
    if (status === 429) return Response.json({ error: 'יותר מדי בקשות. נסו שוב בעוד דקה.' }, { status });
    console.error('Payroll report could not be loaded', status || 'unknown');
    return Response.json({ error: 'לא ניתן היה להפיק דוח שעות לשכר.' }, { status: 500 });
  }
}