import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveInternalRole } from '../../shared/internalRoleAuth.js';
import { isValidDateString } from '../../shared/groupStayPeriods.js';
import { isGroupOperationallyEnabled } from '../../shared/groupOperationalIsolation.js';
import {
  groupDayPresence, isSelectablePresence, stationGroupCheck, evaluateStationSpace,
  participantIssue, worstStatus, isTime, toMinutes, DAY_END,
} from '../../shared/activityDayPlanning.js';

// STRICTLY READ-ONLY preview of an activity day built from a READY ActivityDayTemplate.
// This function performs no create/update/delete on any entity and calls no calendar or notification.
const ALLOWED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
const ACTIONS = new Set(['load_template', 'load_day', 'preview']);
const CANDIDATE_STATUSES = new Set(['CONFIRMED', 'PENDING_APPROVAL']);
const MAX_STATIONS = 50;
const MAX_GROUPS_PER_STATION = 100;
const LOGISTICS_KEYS = ['needs_projector', 'needs_screen', 'needs_microphone', 'needs_sound', 'needs_whiteboard', 'needs_chair_circle', 'chairs_count', 'logistics_other'];

const json = (body, status = 200) => Response.json(body, { status });
const fail = (status, error, extra = {}) => json({ success: false, error, ...extra }, status);
const hhmm = (m) => (m >= DAY_END ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
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

// Canonical Mechina identification = active MechinaGroupAssignment linked to an existing Group.
async function loadMechinaDay(db, date) {
  const assignments = await db.MechinaGroupAssignment.filter({ is_active: true }, 'group_id', 2000);
  const ids = [...new Set(assignments.map(a => a.group_id).filter(isId))];
  const groups = ids.length ? await db.Group.filter({ id: { $in: ids } }, 'group_name', 1000) : [];
  const candidates = groups.filter(g => CANDIDATE_STATUSES.has(g.status) && isGroupOperationallyEnabled(g));
  const periods = candidates.length
    ? await db.GroupStayPeriod.filter({ group_id: { $in: candidates.map(g => g.id) }, status: 'ACTIVE' }, 'start_date', 5000)
    : [];
  const out = [];
  for (const g of candidates) {
    let presence = groupDayPresence(g, periods, date);
    if (presence.state === 'NOT_PRESENT') continue;
    if (g.status !== 'CONFIRMED' && isSelectablePresence(presence)) {
      presence = { state: 'UNVERIFIABLE', reason: 'GROUP_NOT_CONFIRMED', message: 'הקבוצה טרם אושרה סופית', period: presence.period };
    }
    const pc = Number(g.participant_count), tp = Number(g.total_pax);
    const participantWarning = !(Number.isFinite(pc) && pc > 0) ? 'כמות המשתתפים בקבוצה אינה ידועה'
      : (Number.isFinite(tp) && tp > 0 && pc > tp ? 'כמות המשתתפים גבוהה מסך האנשים בקבוצה' : null);
    out.push({
      id: g.id, group_name: g.group_name, stay_mode: g.stay_mode || 'CONTINUOUS', group_type: g.group_type,
      participant_count: Number.isFinite(pc) ? pc : null, participant_warning: participantWarning,
      presence: {
        state: presence.state, reason: presence.reason || null, message: presence.message || null,
        from: presence.from !== undefined ? hhmm(presence.from) : null, to: presence.to !== undefined ? hhmm(presence.to) : null,
        is_arrival: !!presence.is_arrival, is_departure: !!presence.is_departure, period: presence.period || null,
      },
      _presence: presence,
    });
  }
  return out.sort((a, b) => String(a.group_name).localeCompare(String(b.group_name), 'he', { numeric: true }));
}

const publicGroup = ({ _presence, ...rest }) => rest;

function sanitizePlanStations(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_STATIONS) : [];
  return list.map((s, i) => {
    const groups = (Array.isArray(s?.groups) ? s.groups : []).slice(0, MAX_GROUPS_PER_STATION)
      .filter(g => isId(g?.group_id))
      .map(g => ({ group_id: g.group_id, participants: g.participants === '' || g.participants === null || g.participants === undefined ? null : Number(g.participants) }));
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

  const withTotals = stations.map(s => ({
    ...s, total_participants: s.groups.reduce((sum, g) => sum + (Number.isFinite(g.participants) ? g.participants : 0), 0),
  }));
  const ctx = { date, spacesById, blocks, groupItems, standalone, standaloneSpaceIdsByReservation, pendingRequests, stations: withTotals };

  const results = withTotals.map(station => {
    const issues = evaluateStationSpace(station, ctx);
    const groupResults = station.groups.map(sel => {
      const group = groupsById[sel.group_id];
      const check = stationGroupCheck(group?._presence, station.start_time, station.end_time);
      const notes = [];
      const pIssue = participantIssue(sel.participants, group);
      if (pIssue) notes.push(pIssue.message);
      // A group cannot attend two overlapping stations at the same time.
      const clash = withTotals.find(o => o.station_id !== station.station_id && o.groups.some(g => g.group_id === sel.group_id)
        && isTime(o.start_time) && isTime(o.end_time) && isTime(station.start_time) && isTime(station.end_time)
        && toMinutes(station.start_time) < toMinutes(o.end_time) && toMinutes(o.start_time) < toMinutes(station.end_time));
      if (clash) notes.push(`משובצת גם בתחנה חופפת "${clash.title || 'ללא שם'}"`);
      return {
        group_id: sel.group_id, group_name: group?.group_name || 'קבוצה שאינה זמינה בתאריך זה',
        participants: Number.isFinite(sel.participants) ? sel.participants : null,
        eligible: check.ok, code: check.ok ? null : check.code, message: check.ok ? null : check.message,
        notes, has_warning: !!pIssue || !!clash,
      };
    });
    if (station.groups.length === 0) issues.push({ status: 'UNVERIFIABLE', code: 'NO_GROUPS', message: 'לא שובצו מכינות לתחנה' });
    if (groupResults.some(g => !g.eligible)) issues.push({ status: 'UNVERIFIABLE', code: 'INVALID_GROUP_ASSIGNMENT', message: 'חלק מהמכינות אינן זכאיות או שלא ניתן לאמת את נוכחותן בשעות התחנה' });
    if (groupResults.some(g => g.has_warning)) issues.push({ status: 'UNVERIFIABLE', code: 'GROUP_WARNINGS', message: 'יש אזהרות בכמויות או בשיבוץ המכינות' });
    const space = spacesById[station.space_id];
    return {
      station_id: station.station_id, title: station.title, start_time: station.start_time, end_time: station.end_time,
      space_id: station.space_id || null, space_name: space?.name || null, space_capacity: Number.isFinite(Number(space?.capacity)) && Number(space?.capacity) > 0 ? Number(space.capacity) : null,
      total_participants: station.total_participants, logistics: Object.fromEntries(LOGISTICS_KEYS.map(k => [k, station[k]])),
      groups: groupResults, issues, status: worstStatus(issues),
    };
  });
  return results;
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
        spaces: spaces.map(s => ({ id: s.id, name: s.name, capacity: s.capacity ?? null, is_bookable: s.is_bookable !== false, working_status: s.working_status || 'WORKING' })),
      });
    }

    if (!isValidDateString(body.date)) return fail(400, 'יש לבחור תאריך תקין');
    const groups = await loadMechinaDay(db, body.date);

    if (body.action === 'load_day') return json({ success: true, date: body.date, groups: groups.map(publicGroup) });

    // preview — everything is revalidated here from current records; nothing is stored.
    const stations = sanitizePlanStations(body.stations);
    if (stations.length === 0) return fail(400, 'אין תחנות בתוכנית');
    const groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
    const results = await buildPreview(db, body.date, stations, groupsById);
    return json({
      success: true, preview_only: true, date: body.date,
      template: { id: template.id, version: template.version, name: template.name, updated_date: template.updated_date },
      template_changed: typeof body.template_updated_date === 'string' && body.template_updated_date.replace(/Z$/, '').slice(0, 23) !== String(template.updated_date).replace(/Z$/, '').slice(0, 23),
      stations: results, groups: groups.map(publicGroup), checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[planActivityDayFromTemplate]', err?.message, err?.stack);
    return fail(500, 'שגיאה פנימית — נסה שוב');
  }
}