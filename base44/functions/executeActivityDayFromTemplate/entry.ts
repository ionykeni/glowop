import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { resolveInternalRole } from '../../shared/internalRoleAuth.js';
import { isValidDateString } from '../../shared/groupStayPeriods.js';
import { checkActivitySpaceConflict } from '../../shared/activitySpaceAvailability.js';
import { isGroupDeparted } from '../../shared/activityCreationWindow.js';
import { isId, LOGISTICS_KEYS, loadGroupsForDay, sanitizePlanStations, buildPreview } from '../../shared/activityDayPlanData.js';
import { json, fail, sameStamp } from '../../shared/activityDayHttp.js';
import { isExecutionKey, planFingerprintSource, classifyPreview, buildScheduleItemPayload, executionCounts, pendingStationIds, writePendingStations } from '../../shared/activityDayExecution.js';

// Phase C1: turns an explicitly confirmed activity-day plan into real GroupScheduleItem records.
// - One station = one shared_activity_id; one GroupScheduleItem per participating Group (existing shared model).
// - Idempotent per execution_key; a stored ActivityDayExecution tracks every created item for safe resume.
// - Executions are serialized by a global compare-and-set lease (ActivityDayExecutionLock).
//   Other booking modules do not take this lock (documented limitation).
// - No Google Calendar calls and no CalendarSync writes here: the existing entity workflow mirrors items as usual.
const ALLOWED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
const LOCK_KEY = 'GLOBAL';
const LEASE_MS = 6 * 60 * 1000; // longer than the 5-minute request limit, so a live holder never loses it
const failWith = (status, outcome, error, extra = {}) => fail(status, error, { outcome, ...extra });
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function acquireLock(db, key) {
  let rows = await db.ActivityDayExecutionLock.filter({ lock_key: LOCK_KEY }, 'created_date', 5);
  if (!rows.length) {
    await db.ActivityDayExecutionLock.create({ lock_key: LOCK_KEY });
    rows = await db.ActivityDayExecutionLock.filter({ lock_key: LOCK_KEY }, 'created_date', 5);
  }
  const lock = rows[0]; // oldest row is the canonical lock for every caller
  const nowIso = new Date().toISOString();
  const held = !!lock.holder_execution_key && !(lock.expires_at && lock.expires_at < nowIso);
  if (held) return null;
  const query = lock.holder_execution_key
    ? { id: lock.id, holder_execution_key: lock.holder_execution_key, expires_at: lock.expires_at }
    : { id: lock.id, holder_execution_key: null };
  const res = await db.ActivityDayExecutionLock.updateMany(query, {
    $set: { holder_execution_key: key, acquired_at: nowIso, expires_at: new Date(Date.now() + LEASE_MS).toISOString() },
  });
  return res?.updated === 1 ? lock.id : null;
}

const releaseLock = (db, lockId, key) =>
  db.ActivityDayExecutionLock.updateMany({ id: lockId, holder_execution_key: key }, { $unset: { holder_execution_key: '', expires_at: '' } }).catch(e => console.error('[executeActivityDay] lock release failed', e?.message));

async function findExecution(db, key) {
  return (await db.ActivityDayExecution.filter({ execution_key: key }, 'created_date', 1))[0] || null;
}

async function present(db, exec) {
  if (!exec) return null;
  const stations = parse(exec.stations_json, []);
  const ids = stations.flatMap(s => Object.values(s.items || {}));
  const syncs = ids.length ? await db.CalendarSync.filter({ group_schedule_item_id: { $in: ids } }, 'created_date', 2000) : [];
  return {
    execution_key: exec.execution_key, state: exec.state, date: exec.date,
    template_id: exec.template_id, template_name: exec.template_name, template_version: exec.template_version,
    started_at: exec.started_at, completed_at: exec.completed_at || null, last_error: exec.last_error || null,
    warnings: parse(exec.warnings_json, []),
    stations: stations.map(s => ({
      station_id: s.station_id, title: s.title, space_name: s.space_name, start_time: s.start_time, end_time: s.end_time,
      shared_activity_id: s.shared_activity_id,
      groups: s.groups.map(g => ({ group_id: g.group_id, group_name: g.group_name, item_id: s.items?.[g.group_id] || null })),
    })),
    counts: executionCounts(stations),
    // Observation only: the existing workflow mirrors items to Google Calendar asynchronously.
    calendar_sync: { observed: new Set(syncs.map(s => s.group_schedule_item_id)).size, total: ids.length },
  };
}

// Full revalidation from current records. Returns blockers/warnings for the stations still to be written.
async function revalidate(base44, db, date, planStations, sharedIds, pendingIds) {
  const groups = await loadGroupsForDay(db, date);
  const groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
  const results = await buildPreview(db, date, planStations, groupsById, new Set(sharedIds));
  const relevant = results.filter(r => pendingIds.has(r.station_id));
  const { blockers, warnings } = classifyPreview(relevant);

  const allGroupIds = [...new Set(relevant.flatMap(r => r.groups.map(g => g.group_id)))];
  const profiles = allGroupIds.length ? await db.OperationalGroupProfile.filter({ group_id: { $in: allGroupIds } }, 'created_date', 2000) : [];
  const profileByGroup = {};
  for (const p of profiles) if (!profileByGroup[p.group_id]) profileByGroup[p.group_id] = p.id;

  for (const r of relevant) {
    const reasons = [];
    for (const g of r.groups) {
      if (!profileByGroup[g.group_id]) reasons.push(`לא נמצא פרופיל תפעולי לקבוצה "${g.group_name}"`);
      const full = groupsById[g.group_id];
      if (full && isGroupDeparted(full)) reasons.push(`הקבוצה "${g.group_name}" כבר עזבה את האתר`);
    }
    if (reasons.length) blockers.push({ station_id: r.station_id, title: r.title, space_name: r.space_name, start_time: r.start_time, end_time: r.end_time, reasons });
  }

  // Authoritative per-station check with the production conflict engine (same one saveGroupScheduleItem uses).
  const blockedIds = new Set(blockers.map(b => b.station_id));
  const toCheck = relevant.filter(r => !blockedIds.has(r.station_id));
  const sharedByStation = Object.fromEntries(planStations.map((s, i) => [s.station_id, sharedIds[i]]));
  for (let i = 0; i < toCheck.length; i += 6) {
    const batch = toCheck.slice(i, i + 6);
    const conflicts = await Promise.all(batch.map(r => checkActivitySpaceConflict(base44, {
      spaceId: r.space_id, date, startTime: r.start_time, endTime: r.end_time, excludeSharedActivityId: sharedByStation[r.station_id] || null,
    })));
    conflicts.forEach((c, j) => {
      if (!c) return;
      const r = batch[j];
      const detail = c.conflicting_title ? ` — ${c.conflicting_title} (${c.start_time || ''}–${c.end_time || ''})` : '';
      blockers.push({ station_id: r.station_id, title: r.title, space_name: r.space_name, start_time: r.start_time, end_time: r.end_time, reasons: [`${c.message}${detail}`] });
    });
  }
  return { blockers, warnings, results, profileByGroup };
}

// `stations` is the FULL journal; only `pendingIds` are written, but every persist stores all stations.
const writeStations = (db, exec, stations, pendingIds, profileByGroup) => writePendingStations({
  stations, pendingIds,
  findExisting: (st) => db.GroupScheduleItem.filter({ shared_activity_id: st.shared_activity_id }, 'created_date', 500),
  createItem: (st, gid) => db.GroupScheduleItem.create(buildScheduleItemPayload({
    station: st, groupId: gid, profileId: profileByGroup[gid], execution: exec, logisticsKeys: LOGISTICS_KEYS,
  })),
  persist: (json) => db.ActivityDayExecution.update(exec.id, { stations_json: json }),
});

async function run(base44, db, exec, actorEmail) {
  const stations = parse(exec.stations_json, []);
  const pendingIds = pendingStationIds(stations);
  if (pendingIds.size === 0) {
    const done = await db.ActivityDayExecution.update(exec.id, { state: 'COMPLETED', completed_at: exec.completed_at || new Date().toISOString(), last_error: '' });
    return json({ success: true, outcome: 'COMPLETED', execution: await present(db, { ...exec, ...done }) });
  }
  const planStations = stations.map(s => ({ station_id: s.station_id, title: s.title, start_time: s.start_time, end_time: s.end_time, space_id: s.space_id, groups: s.groups.map(g => ({ group_id: g.group_id })), ...s.logistics }));
  const { blockers, profileByGroup } = await revalidate(base44, db, exec.date, planStations, stations.map(s => s.shared_activity_id), pendingIds);
  if (blockers.length) {
    const upd = await db.ActivityDayExecution.update(exec.id, { state: 'INCOMPLETE', last_error: 'נמצאו התנגשויות בעת ההשלמה' });
    return failWith(409, 'BLOCKED', 'לא ניתן להשלים את היצירה — נמצאו התנגשויות', { blockers, execution: await present(db, { ...exec, ...upd }) });
  }
  await db.ActivityDayExecution.update(exec.id, { state: 'IN_PROGRESS', attempts: (exec.attempts || 1) + 1, actor_email: actorEmail });
  try {
    await writeStations(db, exec, stations, pendingIds, profileByGroup);
  } catch (err) {
    console.error('[executeActivityDay] write failed', err?.message);
    await db.ActivityDayExecution.update(exec.id, { stations_json: JSON.stringify(stations), state: 'INCOMPLETE', last_error: String(err?.message || 'שגיאת כתיבה').slice(0, 500) }).catch(() => {});
    const fresh = await findExecution(db, exec.execution_key);
    return failWith(500, 'INCOMPLETE', 'היצירה הושלמה חלקית — נדרשת השלמה', { execution: await present(db, fresh) });
  }
  const done = await db.ActivityDayExecution.update(exec.id, { stations_json: JSON.stringify(stations), state: 'COMPLETED', completed_at: new Date().toISOString(), last_error: '' });
  return json({ success: true, outcome: 'COMPLETED', execution: await present(db, { ...exec, ...done, stations_json: JSON.stringify(stations) }) });
}

async function startExecution(base44, db, body, user) {
  if (!isId(body.template_id)) return failWith(400, 'INVALID', 'חסר מזהה תבנית');
  if (!isValidDateString(body.date)) return failWith(400, 'INVALID', 'יש לבחור תאריך תקין');
  const template = await db.ActivityDayTemplate.get(body.template_id).catch(e => (e.status === 404 ? null : Promise.reject(e)));
  if (!template) return failWith(404, 'INVALID', 'התבנית לא נמצאה');
  if (template.status !== 'READY') return failWith(409, 'TEMPLATE_NOT_READY', 'ניתן ליצור פעילויות רק מגרסה מוכנה (READY)');
  if (!sameStamp(body.template_updated_date, template.updated_date)) return failWith(409, 'TEMPLATE_CHANGED', 'גרסת התבנית השתנתה — יש לרענן את הדף');
  const planStations = sanitizePlanStations(body.stations);
  if (planStations.length === 0) return failWith(400, 'INVALID', 'אין תחנות בתוכנית');
  const fingerprint = await sha256(planFingerprintSource(template.id, template.version, body.date, planStations));

  const pendingIds = new Set(planStations.map(s => s.station_id));
  const sharedIds = planStations.map(() => crypto.randomUUID());
  const { blockers, warnings, results } = await revalidate(base44, db, body.date, planStations, sharedIds, pendingIds);
  if (blockers.length) return failWith(409, 'BLOCKED', 'לא ניתן ליצור את יום הפעילות — נמצאו התנגשויות', { blockers });

  const stations = results.map((r, i) => ({
    station_id: r.station_id, title: r.title, space_id: r.space_id, space_name: r.space_name, space_code: r.space_code,
    start_time: r.start_time, end_time: r.end_time, logistics: r.logistics, shared_activity_id: sharedIds[i],
    groups: r.groups.map(g => ({ group_id: g.group_id, group_name: g.group_name })), items: {},
  }));
  const exec = await db.ActivityDayExecution.create({
    execution_key: body.execution_key, request_fingerprint: fingerprint, template_id: template.id, template_family_id: template.family_id,
    template_version: template.version, template_name: template.name, date: body.date, state: 'IN_PROGRESS',
    stations_json: JSON.stringify(stations), warnings_json: JSON.stringify(warnings), actor_email: user.email,
    started_at: new Date().toISOString(), attempts: 0,
  });
  return run(base44, db, exec, user.email);
}

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me().catch(e => (e.status === 401 || e.status === 403 ? null : Promise.reject(e)));
    if (!user) return failWith(401, 'UNAUTHORIZED', 'נדרשת התחברות');
    const role = await resolveInternalRole(base44, user);
    if (!ALLOWED_ROLES.has(role)) return failWith(403, 'FORBIDDEN', 'אין הרשאה ליצירת ימי פעילות');

    const body = await req.json().catch(() => ({}));
    if (!isExecutionKey(body.execution_key)) return failWith(400, 'INVALID', 'מזהה ביצוע חסר או לא תקין');
    const db = base44.asServiceRole.entities;

    if (body.action === 'status') return json({ success: true, execution: await present(db, await findExecution(db, body.execution_key)) });
    if (body.action !== 'execute' && body.action !== 'resume') return failWith(400, 'INVALID', 'פעולה לא מוכרת');
    if (body.action === 'execute' && body.confirmed !== true) return failWith(400, 'NOT_CONFIRMED', 'נדרש אישור מפורש לפני יצירת פעילויות');

    // Fast path outside the lock: completed executions are returned as-is.
    const before = await findExecution(db, body.execution_key);
    if (before?.state === 'COMPLETED') return json({ success: true, outcome: 'COMPLETED', replay: true, execution: await present(db, before) });
    if (body.action === 'resume' && !before) return failWith(404, 'NOT_FOUND', 'הביצוע לא נמצא');

    const lockId = await acquireLock(db, body.execution_key);
    if (!lockId) return failWith(409, 'BUSY', 'יצירת יום פעילות אחר מתבצעת כעת — נסה שוב בעוד רגע', { retryable: true });
    try {
      const exec = await findExecution(db, body.execution_key); // re-read under the lock
      if (exec?.state === 'COMPLETED') return json({ success: true, outcome: 'COMPLETED', replay: true, execution: await present(db, exec) });
      if (exec) {
        if (body.action === 'execute') {
          const t = await db.ActivityDayTemplate.get(exec.template_id).catch(() => null);
          const fp = t ? await sha256(planFingerprintSource(t.id, t.version, body.date, sanitizePlanStations(body.stations))) : '';
          if (fp !== exec.request_fingerprint) return failWith(409, 'KEY_REUSED', 'מזהה הביצוע כבר שימש לתוכנית אחרת');
        }
        return await run(base44, db, exec, user.email);
      }
      if (body.action === 'resume') return failWith(404, 'NOT_FOUND', 'הביצוע לא נמצא');
      return await startExecution(base44, db, body, user);
    } finally {
      await releaseLock(db, lockId, body.execution_key);
    }
  } catch (err) {
    console.error('[executeActivityDayFromTemplate]', err?.message, err?.stack);
    return failWith(500, 'ERROR', 'שגיאה פנימית — יש לבדוק את מצב הביצוע לפני ניסיון חוזר');
  }
}