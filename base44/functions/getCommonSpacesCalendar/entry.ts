import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { buildSpaceCalendar } from '../../shared/spaceCalendarModel.js';

// Read-only, display-safe data for the visual common-spaces calendar.
const ALLOWED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'MAINTENANCE', 'VIEWER'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => ([401, 403].includes(e?.status) ? null : Promise.reject(e)));
    if (!user) return Response.json({ success: false, error: 'לא מחובר' }, { status: 401 });

    const email = String(user.email || '').trim().toLowerCase();
    const internalRows = await base44.asServiceRole.entities.InternalUser.filter({ active: true });
    const internalUser = internalRows.find(row => String(row.email || '').trim().toLowerCase() === email);
    if (!internalUser || !ALLOWED_ROLES.includes(internalUser.role)) {
      return Response.json({ success: false, error: 'אין הרשאה לצפות ביומן המרחבים' }, { status: 403 });
    }

    const { start_date: start, end_date: end } = await req.json().catch(() => ({}));
    if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '') || start > end) {
      return Response.json({ success: false, error: 'טווח תאריכים לא תקין' }, { status: 400 });
    }
    const days = (Date.parse(end) - Date.parse(start)) / 86400000;
    if (days > 31) return Response.json({ success: false, error: 'טווח מקסימלי 31 ימים' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    const range = { $gte: start, $lte: end };
    const [spaces, scheduleItems, standalone, blocks, requests, mechinaAssignments] = await Promise.all([
      db.ActivitySpace.list('name', 500),
      db.GroupScheduleItem.filter({ date: range, status: 'ACTIVE' }, 'date', 5000),
      db.StandaloneActivityReservation.filter({ event_date: range, status: 'ACTIVE' }, 'event_date', 1000),
      db.ActivitySpaceBlock.filter({ status: 'ACTIVE' }, '-start_date', 1000),
      db.CommonSpaceBookingRequest.filter({ date: range, status: 'PENDING' }, 'date', 1000),
      db.MechinaGroupAssignment.filter({ is_active: true }, 'group_id', 1000),
    ]);

    const spacedItems = scheduleItems.filter(item => !!item.activity_space_id);
    const groupIds = [...new Set([...spacedItems.map(i => i.group_id), ...requests.map(r => r.mechina_group_id)].filter(Boolean))];
    const reservationIds = standalone.map(r => r.id);
    const [groups, assignments] = await Promise.all([
      groupIds.length ? db.Group.filter({ id: { $in: groupIds } }, 'group_name', 2000) : [],
      reservationIds.length ? db.StandaloneActivitySpaceAssignment.filter({ reservation_id: { $in: reservationIds } }, 'reservation_id', 3000) : [],
    ]);

    const model = buildSpaceCalendar({
      spaces, scheduleItems: spacedItems, groups, standalone, assignments, blocks, requests, start, end,
      mechinaGroupIds: mechinaAssignments.map(a => a.group_id),
    });
    return Response.json({ success: true, range: { start, end }, can_manage: ['SUPER_ADMIN', 'ADMIN'].includes(internalUser.role), ...model });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || 'שגיאה בטעינת היומן' }, { status: 500 });
  }
}