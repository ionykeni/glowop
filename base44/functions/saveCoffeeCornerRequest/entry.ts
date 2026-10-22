import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { authorizeDatedOperationalManager, validateDatedOperationalDate } from '../../shared/datedOperationalPeriodValidation.js';

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'נדרשת התחברות' }, { status: 401 });
    if (!await authorizeDatedOperationalManager(base44, user)) return Response.json({ success: false, error: 'אין הרשאה לניהול פעילויות' }, { status: 403 });
    const { id, ...payload } = await req.json();
    const current = id ? await base44.asServiceRole.entities.CoffeeCornerRequest.get(id).catch(() => null) : null;
    if (id && !current) return Response.json({ success: false, error: 'בקשת פינת הקפה לא נמצאה' }, { status: 404 });
    const groupId = current?.group_id || payload.group_id;
    if (!groupId || (current && payload.group_id !== current.group_id)) return Response.json({ success: false, error: 'קבוצה לא תקינה' }, { status: 400 });
    const group = await base44.asServiceRole.entities.Group.get(groupId).catch(() => null);
    if (!group) return Response.json({ success: false, error: 'הקבוצה לא נמצאה' }, { status: 404 });
    const validation = await validateDatedOperationalDate(base44, group, payload.date);
    if (!validation.valid) return Response.json({ success: false, error: validation.message, error_code: validation.code }, { status: 400 });
    const item = id
      ? await base44.asServiceRole.entities.CoffeeCornerRequest.update(id, payload)
      : await base44.asServiceRole.entities.CoffeeCornerRequest.create(payload);
    return Response.json({ success: true, item });
  } catch (error) {
    return Response.json({ success: false, error: error.message || 'שמירת פינת הקפה נכשלה' }, { status: 500 });
  }
}