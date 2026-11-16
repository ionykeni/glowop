import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { handleWorkScheduleRead } from '../../shared/workScheduleRead.js';

// Read-only schedule views (actions: week | my_week | dashboard_day). Authorization lives in the shared handler.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    return await handleWorkScheduleRead(base44, body);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}