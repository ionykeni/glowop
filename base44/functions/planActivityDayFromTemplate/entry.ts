import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveInternalRole } from '../../shared/internalRoleAuth.js';
import { isValidDateString } from '../../shared/groupStayPeriods.js';
import { uniqueGroupsSummary } from '../../shared/activityDayPlanning.js';
import { json, fail } from '../../shared/activityDayHttp.js';
import { isId, loadGroupsForDay, sanitizePlanStations, buildPreview } from '../../shared/activityDayPlanData.js';

// STRICTLY READ-ONLY preview of an activity day built from a READY ActivityDayTemplate.
// This function performs no create/update/delete on any entity and calls no calendar or notification.
// Eligibility is date-only for every operational group type; no participant/capacity validation (this workflow only).
const ALLOWED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
const ACTIONS = new Set(['load_template', 'load_day', 'preview']);


async function loadReadyTemplate(db, templateId) {
  if (!isId(templateId)) return { error: fail(400, 'חסר מזהה תבנית') };
  const template = await db.ActivityDayTemplate.get(templateId).catch(e => (e.status === 404 ? null : Promise.reject(e)));
  if (!template) return { error: fail(404, 'התבנית לא נמצאה') };
  if (template.status !== 'READY') return { error: fail(409, 'ניתן לתכנן יום רק מגרסה מוכנה (READY)', { code: 'TEMPLATE_NOT_READY' }) };
  return { template };
}

const presentTemplate = (t) => ({
  id: t.id, family_id: t.family_id, version: t.version, name: t.name, description: t.description || '',
  updated_date: t.updated_date, stations: t.stations || [],
});

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(e => (e.status === 401 || e.status === 403 ? null : Promise.reject(e)));
    if (!user) return fail(401, 'נדרשת התחברות');
    const role = await resolveInternalRole(base44, user);
    if (!ALLOWED_ROLES.has(role)) return fail(403, 'אין הרשאה לתכנון ימי פעילות');

    const body = await req.json().catch(() => ({}));
    if (!ACTIONS.has(body.action)) return fail(400, 'פעולה לא מוכרת');
    const db = base44.asServiceRole.entities;

    const { template, error } = await loadReadyTemplate(db, body.template_id);
    if (error) return error;

    if (body.action === 'load_template') {
      const spaces = await db.ActivitySpace.list('name', 500);
      return json({
        success: true, template: presentTemplate(template),
        spaces: spaces.map(s => ({ id: s.id, name: s.name, is_bookable: s.is_bookable !== false, working_status: s.working_status || 'WORKING' })),
      });
    }

    if (!isValidDateString(body.date)) return fail(400, 'יש לבחור תאריך תקין');
    const groups = await loadGroupsForDay(db, body.date);

    if (body.action === 'load_day') return json({ success: true, date: body.date, groups });

    // preview — everything is revalidated here from current records; nothing is stored.
    const stations = sanitizePlanStations(body.stations);
    if (stations.length === 0) return fail(400, 'אין תחנות בתוכנית');
    const groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
    const results = await buildPreview(db, body.date, stations, groupsById);
    return json({
      success: true, preview_only: true, date: body.date,
      template: { id: template.id, version: template.version, name: template.name, updated_date: template.updated_date },
      template_changed: typeof body.template_updated_date === 'string' && body.template_updated_date.replace(/Z$/, '').slice(0, 23) !== String(template.updated_date).replace(/Z$/, '').slice(0, 23),
      stations: results, summary: uniqueGroupsSummary(stations, groupsById), groups, checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[planActivityDayFromTemplate]', err?.message, err?.stack);
    return fail(500, 'שגיאה פנימית — נסה שוב');
  }
}