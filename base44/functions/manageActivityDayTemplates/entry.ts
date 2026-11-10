import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { sanitizeStations, validateTemplate } from '../../shared/activityDayTemplate.js';
import { resolveInternalRole } from '../../shared/internalRoleAuth.js';
import { json, fail, sameStamp } from '../../shared/activityDayHttp.js';

// Planning-only templates. This function reads ActivitySpace for reference validation and
// reads/writes ONLY ActivityDayTemplate. It never touches operational entities or calendars.
const ALLOWED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
const ACTIONS = new Set(['list', 'get_family', 'create', 'save_draft', 'new_version', 'mark_ready']);
const MAX_TEMPLATES = 500;



async function loadSpaceInfo(base44, stations) {
  // Malformed ids can't match a real record; they are left out and reported as SPACE_NOT_FOUND.
  const ids = [...new Set(stations.map(s => s.suggested_space_id).filter(id => /^[a-f0-9]{24}$/i.test(id || '')))];
  if (ids.length === 0) return { spaceIds: new Set(), warnings: [] };
  const spaces = await base44.asServiceRole.entities.ActivitySpace.filter({ id: { $in: ids } });
  const warnings = spaces
    .filter(sp => sp.is_bookable === false || (sp.working_status && sp.working_status !== 'WORKING'))
    .map(sp => `המרחב "${sp.name}" אינו זמין כרגע — הזמינות תיבדק מחדש בעת יצירת יום פעילות`);
  return { spaceIds: new Set(spaces.map(s => s.id)), warnings };
}

async function loadFamily(base44, familyId) {
  const rows = await base44.asServiceRole.entities.ActivityDayTemplate.filter({ family_id: familyId }, '-version', 200);
  return rows;
}

function summarizeFamilies(rows) {
  const families = new Map();
  for (const row of rows) {
    const list = families.get(row.family_id) || [];
    list.push(row);
    families.set(row.family_id, list);
  }
  return [...families.values()].map(list => {
    list.sort((a, b) => b.version - a.version);
    const latest = list[0];
    const latestReady = list.find(r => r.status === 'READY') || null;
    return {
      family_id: latest.family_id,
      name: latest.name,
      latest_version: latest.version,
      latest_status: latest.status,
      ready_version: latestReady?.version ?? null,
      has_draft: list.some(r => r.status === 'DRAFT'),
      station_count: (latest.stations || []).length,
      version_count: list.length,
      updated_date: latest.updated_date,
    };
  }).sort((a, b) => String(b.updated_date).localeCompare(String(a.updated_date)));
}

async function validatedPayload(base44, body, forReady) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : '';
  const stations = sanitizeStations(body.stations);
  const { spaceIds, warnings } = await loadSpaceInfo(base44, stations);
  const errors = validateTemplate({ name, stations }, { forReady, spaceIds });
  return { name, description, stations, errors, warnings };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(e => (e.status === 401 || e.status === 403 ? null : Promise.reject(e)));
    if (!user) return fail(401, 'נדרשת התחברות');
    const role = await resolveInternalRole(base44, user);
    if (!ALLOWED_ROLES.has(role)) return fail(403, 'אין הרשאה לניהול תבניות ימי פעילות');

    const body = await req.json().catch(() => ({}));
    if (!ACTIONS.has(body.action)) return fail(400, 'פעולה לא מוכרת');
    const Template = base44.asServiceRole.entities.ActivityDayTemplate;
    const email = user.email;

    if (body.action === 'list') {
      const rows = await Template.list('-updated_date', MAX_TEMPLATES);
      const search = typeof body.search === 'string' ? body.search.trim() : '';
      const families = summarizeFamilies(rows).filter(f => !search || String(f.name || '').includes(search));
      return json({ success: true, families });
    }

    if (body.action === 'get_family') {
      if (typeof body.family_id !== 'string' || !body.family_id) return fail(400, 'חסר מזהה תבנית');
      const versions = await loadFamily(base44, body.family_id);
      if (versions.length === 0) return fail(404, 'התבנית לא נמצאה');
      const { warnings } = await loadSpaceInfo(base44, versions.flatMap(v => v.stations || []));
      return json({ success: true, versions, warnings });
    }

    if (body.action === 'create') {
      const p = await validatedPayload(base44, body, false);
      if (p.errors.length) return fail(400, p.errors[0].message, { errors: p.errors });
      const created = await Template.create({
        family_id: crypto.randomUUID(), version: 1, status: 'DRAFT',
        name: p.name, description: p.description, stations: p.stations,
        created_by_email: email, updated_by_email: email,
      });
      return json({ success: true, template: created, warnings: p.warnings });
    }

    if (body.action === 'save_draft' || body.action === 'mark_ready') {
      if (typeof body.id !== 'string' || !body.id) return fail(400, 'חסר מזהה גרסה');
      const current = await Template.get(body.id).catch(e => (e.status === 404 ? null : Promise.reject(e)));
      if (!current) return fail(404, 'הגרסה לא נמצאה');
      if (current.status !== 'DRAFT') return fail(409, 'גרסה מוכנה אינה ניתנת לשינוי', { error_code: 'READY_IMMUTABLE' });
      if (body.expected_updated_date && !sameStamp(body.expected_updated_date, current.updated_date)) {
        return fail(409, 'הגרסה עודכנה במקום אחר — יש לרענן לפני שמירה', { error_code: 'STALE_VERSION' });
      }

      if (body.action === 'save_draft') {
        const p = await validatedPayload(base44, body, false);
        if (p.errors.length) return fail(400, p.errors[0].message, { errors: p.errors });
        const updated = await Template.update(current.id, {
          name: p.name, description: p.description, stations: p.stations, updated_by_email: email,
        });
        return json({ success: true, template: updated, warnings: p.warnings });
      }

      if (body.confirm !== true) return fail(400, 'נדרש אישור מפורש לסימון התבנית כמוכנה');
      const p = await validatedPayload(base44, { ...current, stations: current.stations }, true);
      if (p.errors.length) return fail(400, 'התבנית אינה שלמה', { errors: p.errors });
      // Re-check right before the write: a parallel request may have already finalized it.
      const fresh = await Template.get(current.id);
      if (fresh.status !== 'DRAFT' || !sameStamp(fresh.updated_date, current.updated_date)) {
        return fail(409, 'הגרסה השתנתה במהלך הפעולה — יש לרענן', { error_code: 'STALE_VERSION' });
      }
      const ready = await Template.update(current.id, {
        status: 'READY', stations: p.stations, ready_at: new Date().toISOString(),
        ready_by_email: email, updated_by_email: email,
      });
      return json({ success: true, template: ready });
    }

    // new_version: one open DRAFT per family; copies template data only, new station ids.
    if (typeof body.family_id !== 'string' || !body.family_id) return fail(400, 'חסר מזהה תבנית');
    const versions = await loadFamily(base44, body.family_id);
    if (versions.length === 0) return fail(404, 'התבנית לא נמצאה');
    const openDraft = versions.find(v => v.status === 'DRAFT');
    if (openDraft) return json({ success: true, template: openDraft, existing: true });
    const source = versions.find(v => v.status === 'READY');
    const nextVersion = Math.max(...versions.map(v => Number(v.version) || 0)) + 1;
    const created = await Template.create({
      family_id: source.family_id, version: nextVersion, status: 'DRAFT',
      name: source.name, description: source.description || '',
      stations: sanitizeStations(source.stations, { keepIds: false }),
      based_on_template_id: source.id, created_by_email: email, updated_by_email: email,
    });
    // Duplicate guard for concurrent requests: keep the earliest record for this version number.
    const after = await loadFamily(base44, body.family_id);
    const sameVersion = after.filter(v => v.version === nextVersion).sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)) || a.id.localeCompare(b.id));
    if (sameVersion.length > 1 && sameVersion[0].id !== created.id) {
      await Template.delete(created.id);
      return json({ success: true, template: sameVersion[0], existing: true });
    }
    return json({ success: true, template: created });
  } catch (error) {
    console.error('[manageActivityDayTemplates]', error?.message);
    return fail(500, 'שגיאה פנימית בניהול תבניות');
  }
}