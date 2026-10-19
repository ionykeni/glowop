import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { presentMechinaSpace, rejectPendingMechinaRequests } from '../../shared/mechinaSpaceEligibility.js';

export default async function(req) {
  let persistedSpace = null;
  try {
    const base44 = createClientFromRequest(req);
    let user;
    try { user = await base44.auth.me(); }
    catch (error) {
      const status = error?.status || error?.statusCode || error?.response?.status;
      if (status === 401 || status === 403) return Response.json({ success: false, error: 'לא מחובר' }, { status: 401 });
      throw error;
    }
    if (!user) return Response.json({ success: false, error: 'לא מחובר' }, { status: 401 });
    const body = await req.json();
    if (body.action === 'list') {
      const page = await base44.entities.ActivitySpace.filter({}, { sort: 'name', limit: 50, ...(body.cursor ? { cursor: body.cursor } : {}) });
      return Response.json({ success: true, spaces: page.items.map(presentMechinaSpace), next_cursor: page.next_cursor, has_more: page.has_more });
    }
    const internalRows = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const internalUser = internalRows[0];
    if (user.role !== 'admin' || internalUser?.active === false || !['ADMIN', 'SUPER_ADMIN'].includes(internalUser?.role)) {
      return Response.json({ success: false, error: 'אין הרשאה לשנות זמינות בקשות מכינה' }, { status: 403 });
    }
    if (!['preview', 'set'].includes(body.action) || typeof body.space_id !== 'string' || !body.space_id) {
      return Response.json({ success: false, error: 'פעולה או מזהה מרחב לא תקינים' }, { status: 400 });
    }
    if (body.action === 'set' && typeof body.enabled !== 'boolean') {
      return Response.json({ success: false, error: 'יש לשלוח ערך פעיל או חסום' }, { status: 400 });
    }
    const space = await base44.asServiceRole.entities.ActivitySpace.get(body.space_id);
    const query = { space_id: space.id, status: 'PENDING' };
    const pendingCount = await base44.asServiceRole.entities.CommonSpaceBookingRequest.count(query);
    if (body.action === 'preview') return Response.json({ success: true, space: presentMechinaSpace(space), pending_count: pendingCount });
    if (!body.enabled && (body.confirm_disable !== true || body.pending_count !== pendingCount)) {
      return Response.json({ success: false, needs_confirmation: true, pending_count: pendingCount, space: presentMechinaSpace(space), error: 'מספר הבקשות הממתינות עודכן. יש לאשר שוב את החסימה והדחייה.' });
    }
    // Persist first. Repeating a disabled-state save safely resumes only remaining PENDING rows.
    persistedSpace = await base44.asServiceRole.entities.ActivitySpace.update(space.id, { mechina_requests_enabled: body.enabled });
    const remaining = body.enabled ? 0 : await rejectPendingMechinaRequests(base44, space.id, user, internalUser);
    return Response.json({ success: remaining === 0, persisted: true, space: presentMechinaSpace(persistedSpace), pending_remaining: remaining,
      partial: remaining > 0, error: remaining ? 'המרחב נחסם, אך נותרו בקשות ממתינות. יש ללחוץ על השלמת דחייה.' : null });
  } catch (error) {
    console.error('[manageMechinaSpaceEligibility]', error?.message);
    return Response.json({ success: false, persisted: !!persistedSpace, partial: !!persistedSpace,
      ...(persistedSpace ? { space: presentMechinaSpace(persistedSpace) } : {}),
      error: persistedSpace ? 'המצב נשמר, אך דחיית הבקשות לא הושלמה או לא אומתה. יש לרענן ולנסות השלמת דחייה; בקשות מאושרות לא שונו.' : 'השינוי לא אומת. יש לרענן ולנסות שוב.' }, { status: persistedSpace ? 200 : 500 });
  }
}