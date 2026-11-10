import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveInternalRole } from '../../shared/internalRoleAuth.js';
import { isValidDateString } from '../../shared/groupStayPeriods.js';
import { isGroupOperationallyEnabled } from '../../shared/groupOperationalIsolation.js';
import {
  groupDayPresence, isSelectablePresence, stationGroupCheck, evaluateStationSpace, worstStatus, uniqueGroupsSummary,
} from '../../shared/activityDayPlanning.js';

// STRICTLY READ-ONLY preview of an activity day built from a READY ActivityDayTemplate.
// This function performs no create/update/delete on any entity and calls no calendar or notification.
// Eligibility is date-only for every operational group type; no participant/capacity validation (this workflow only).
const ALLOWED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
const ACTIONS = new Set(['load_template', 'load_day', 'preview']);
const CANDIDATE_STATUSES = ['CONFIRMED', 'PENDING_APPROVAL'];
const MAX_STATIONS = 50;
const MAX_GROUPS_PER_STATION = 200;
const LOGISTICS_KEYS = ['needs_projector', 'needs_screen', 'needs_microphone', 'needs_sound', 'needs_whiteboard', 'needs_chair_circle', 'chairs_count', 'logistics_other'];

const json = (body, status = 200) => Response.json(body, { status });
const fail = (status, error, extra = {}) => json({ success: false, error, ...extra }, status);
const isId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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

// Every operational Group (any type) whose stored dates place it on site on `date`.
async function loadGroupsForDay(db, date) {
  const [byGroupDates, coveringPeriods] = await Promise.all([
    db.Group.filter({ status: { $in: CANDIDATE_STATUSES }, arrival_date: { $lte: date } }, '-arrival_date', 2000),
    db.GroupStayPeriod.filter({ status: 'ACTIVE', start_date: { $lte: date }, end_date: { $gte: date } }, 'start_date', 2000),
  ]);
  const known = new Set(byGroupDates.map(g => g.id));
  const missingIds = [...new Set(coveringPeriods.map(p => p.group_id).filter(id => isId(id) && !known.has(id)))];
  const extra = missingIds.length ? await db.Group.filter({ id: { $in: missingIds }, status: { $in: CANDIDATE_STATUSES } }, 'group_name', 1000) : [];
  const candidates = [...byGroupDates, ...extra].filter(isGroupOperationallyEnabled);
  const mpIds = candidates.filter(g => g.stay_mode === 'MULTI_PERIOD').map(g => g.id);
  const periods = mpIds.length ? await db.GroupStayPeriod.filter({ group_id: { $in: mpIds }, status: 'ACTIVE' }, 'start_date', 5000) : [];

  const out = [];
  for (const g of candidates) {
    let presence = groupDayPresence(g, periods, date);
    if (presence.state === 'NOT_PRESENT') continue;
    if (g.status !== 'CONFIRMED' && isSelectablePresence(presence)) {
      presence = { state: 'UNVERIFIABLE', reason: 'GROUP_NOT_CONFIRMED', message: 'הקבוצה טרם אושרה סופית', period: presence.period };
    }
    const pc = Number(g.participant_count);
    out.push({
      id: g.id, group_name: g.group_name, stay_mode: g.stay_mode || 'CONTINUOUS', group_type: g.group_type || null,
      participant_count: Number.isFinite(pc) && pc > 0 ? pc : null,
      presence: {
        state: presence.state, reason: presence.reason || null, message: presence.message || null,
        is_arrival: !!presence.is_arrival, is_departure: !!presence.is_departure, period: presence.period || null,
      },
    });
  }
  return out.sort((a, b) => String(a.group_name).localeCompare(String(b.group_name), 'he', { numeric: true }));
}

function sanitizePlanStations(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_STATIONS) : [];
  return list.map((s, i) => {
    const ids = (Array.isArray(s?.groups) ? s.groups : []).map(g => g?.group_id).filter(isId);
    const groups = [...new Set(ids)].slice(0, MAX_GROUPS_PER_STATION).map(group_id => ({ group_id }));
    const logistics = Object.fromEntries(LOGISTICS_KEYS.map(k => [k, s?.[k] ?? null]));
    return {
      station_id: text(s?.station_id, 64) || `idx-${i}`, title: text(s?.title, 200),
      start_time: text(s?.start_time, 5), end_time: text(s?.end_time, 5),
      space_id: isId(s?.space_id) ? s.space_id : '', groups, ...logistics,
    };
  });
}

async function buildPreview(db, date, stations, groupsById) {
  const spaces = await db.ActivitySpace.list('name', 500);
  const spacesById = Object.fromEntries(spaces.map(s => [s.id, s]));
  const spaceIds = [...new Set(stations.map(s => s.space_id).filter(Boolean))];
  const [blocks, groupItems, standalone, pendingRequests] = await Promise.all([
    spaceIds.length ? db.ActivitySpaceBlock.filter({ activity_space_id: { $in: spaceIds }, status: 'ACTIVE' }, 'start_date', 1000) : [],
    db.GroupScheduleItem.filter({ date, status: 'ACTIVE' }, 'start_time', 2000),
    db.StandaloneActivityReservation.filter({ event_date: date, status: 'ACTIVE' }, 'start_time', 500),
    db.CommonSpaceBookingRequest.filter({ date, status: 'PENDING' }, 'start_time', 1000),
  ]);
  const assignments = standalone.length
    ? await db.StandaloneActivitySpaceAssignment.filter({ reservation_id: { $in: standalone.map(r => r.id) } }, 'reservation_id', 2000)
    : [];
  const standaloneSpaceIdsByReservation = {};
  for (const a of assignments) (standaloneSpaceIdsByReservation[a.reservation_id] ||= []).push(a.activity_space_id);
  const ctx = { date, spacesById, blocks, groupItems, standalone, standaloneSpaceIdsByReservation, pendingRequests, stations };

  return stations.map(station => {
    const issues = evaluateStationSpace(station, ctx);
    const groupResults = station.groups.map(sel => {
      const group = groupsById[sel.group_id];
      const check = stationGroupCheck(group?.presence);
      return {
        group_id: sel.group_id, group_name: group?.group_name || 'קבוצה שאינה שוהה באתר בתאריך זה',
        eligible: check.ok, code: check.ok ? null : check.code, message: check.ok ? null : check.message,
      };
    });
    if (station.groups.length === 0) issues.push({ status: 'UNVERIFIABLE', code: 'NO_GROUPS', message: 'לא שובצו קבוצות לתחנה' });
    if (groupResults.some(g => !g.eligible)) issues.push({ status: 'UNVERIFIABLE', code: 'INVALID_GROUP_ASSIGNMENT', message: 'חלק מהקבוצות אינן שוהות באתר בתאריך זה' });
    const space = spacesById[station.space_id];
    return {
      station_id: station.station_id, title: station.title, start_time: station.start_time, end_time: station.end_time,
      space_id: station.space_id || null, space_name: space?.name || null,
      logistics: Object.fromEntries(LOGISTICS_KEYS.map(k => [k, station[k]])),
      groups: groupResults, issues, status: worstStatus(issues),
    };
  });
}

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