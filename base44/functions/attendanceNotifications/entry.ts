import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { attendanceNotificationInbox } from '../../shared/attendanceNotificationInbox.js';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((err) => ((err.status || err.response?.status) === 401 ? null : Promise.reject(err)));
    if (!user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const input = await req.json().catch(() => ({}));
    const { status, ...body } = await attendanceNotificationInbox(base44.asServiceRole.entities.AttendanceNotification, user.id, input);
    return Response.json(body, { status: status || 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[attendanceNotifications]', error?.status || error?.response?.status || error?.message);
    return Response.json({ error: 'לא ניתן לעדכן את ההתראות כרגע' }, { status: 500 });
  }
}