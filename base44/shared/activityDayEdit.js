// Phase C2 pure helpers: editing / cancelling stations of a confirmed activity day.
// No direct I/O (applyStationPlan receives it injected).
// A station is ONE logical activity = one shared_activity_id; one GroupScheduleItem per participating Group.
// Every change is derived from the CURRENT datastore rows, so re-running an operation is idempotent.
import { activityName } from './activityDayExecution.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
export const MAX_EDIT_GROUPS = 200;
export const isStationActive = (s) => s?.status !== 'CANCELLED';
export const isOpId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function normalizeEditTarget(raw) {
  const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 200) : '';
  const start_time = String(raw?.start_time || ''), end_time = String(raw?.end_time || '');
  const group_ids = [...new Set((Array.isArray(raw?.group_ids) ? raw.group_ids : []).filter(isId))];
  const errors = [];
  if (!title) errors.push('יש להזין שם תחנה');
  if (!HHMM.test(start_time) || !HHMM.test(end_time)) errors.push('שעות לא תקינות');
  else if (end_time <= start_time) errors.push('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
  if (!isId(raw?.space_id)) errors.push('יש לבחור מרחב');
  if (group_ids.length === 0) errors.push('יש לשבץ לפחות קבוצה אחת. לביטול התחנה יש להשתמש ב"ביטול תחנה"');
  if (group_ids.length > MAX_EDIT_GROUPS) errors.push('יותר מדי קבוצות');
  return { target: { title, start_time, end_time, space_id: isId(raw?.space_id) ? raw.space_id : '', group_ids }, errors };
}

// Live state of one station. `rows` = GroupScheduleItems carrying the station's shared id, plus journal items by id.
export function stationLiveState(station, rows) {
  const sid = station.shared_activity_id;
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const active = rows.filter(r => r.shared_activity_id === sid && r.status === 'ACTIVE')
    .sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)) || a.id.localeCompare(b.id));
  const activeByGroup = {};
  for (const r of active) (activeByGroup[r.group_id] ||= []).push(r);
  // Journal items that were unlinked from this activity elsewhere but are still active: editing would duplicate them.
  const detached = Object.values(station.items || {}).filter(id => byId[id] && byId[id].status === 'ACTIVE' && byId[id].shared_activity_id !== sid);
  const shapes = new Set(active.map(r => `${r.start_time}|${r.end_time}|${r.activity_space_id}`));
  const expected = `${station.start_time}|${station.end_time}|${station.space_id}`;
  const out_of_sync = isStationActive(station)
    ? shapes.size > 1 || (shapes.size === 1 && !shapes.has(expected))
    : active.length > 0;
  return {
    active, activeByGroup, group_ids: Object.keys(activeByGroup), detached, out_of_sync,
    duplicates: active.length - Object.keys(activeByGroup).length,
  };
}

// Fields every participating item of a station must carry. Shared id never changes.
export function desiredItemFields(execution, station, target, names) {
  return {
    start_time: target.start_time, end_time: target.end_time,
    activity_space_id: target.space_id, activity_space_code: station.space_code || null,
    activity_name: activityName(execution.template_name, target.title),
    shared_activity_id: station.shared_activity_id, is_shared_activity: true,
    shared_activity_group_ids: JSON.stringify(target.group_ids),
    shared_activity_group_names: JSON.stringify(target.group_ids.map(g => names[g] || g)),
  };
}

// What has to change so the datastore matches `target` (null target = cancel the whole station).
// Kept groups are updated in place, new groups get one item, removed groups and duplicates are cancelled.
export function planStationApply(live, target, desired) {
  const updates = [], creates = [], cancels = [];
  const want = new Set(target ? target.group_ids : []);
  for (const [gid, list] of Object.entries(live.activeByGroup)) {
    const [keep, ...extra] = list;
    for (const r of extra) cancels.push(r.id);
    if (!want.has(gid)) { cancels.push(keep.id); continue; }
    const patch = Object.fromEntries(Object.entries(desired || {}).filter(([k, v]) => (keep[k] ?? null) !== v));
    if (Object.keys(patch).length) updates.push({ id: keep.id, patch });
  }
  if (target) for (const gid of target.group_ids) if (!live.activeByGroup[gid]) creates.push(gid);
  return { updates, creates, cancels };
}

export const planIsEmpty = (p) => !p.updates.length && !p.creates.length && !p.cancels.length;

// Sequential, one record per call, so the existing per-record calendar workflow fires for every change.
export async function applyStationPlan(plan, { updateItem, createItem, cancelItem }) {
  for (const u of plan.updates) await updateItem(u.id, u.patch);
  for (const gid of plan.creates) await createItem(gid);
  for (const id of plan.cancels) await cancelItem(id);
}

export const itemsMap = (live) => Object.fromEntries(Object.entries(live.activeByGroup).map(([g, l]) => [g, l[0].id]));

export const stationSnapshot = (s) => ({
  title: s.title, start_time: s.start_time, end_time: s.end_time, space_id: s.space_id, space_name: s.space_name,
  groups: (s.groups || []).map(g => ({ ...g })), items: { ...(s.items || {}) },
});

export function editDiff(station, live, target) {
  const current = new Set(live.group_ids);
  const next = new Set(target.group_ids);
  return {
    time_changed: station.start_time !== target.start_time || station.end_time !== target.end_time,
    space_changed: station.space_id !== target.space_id,
    title_changed: (station.title || '') !== target.title,
    added: target.group_ids.filter(g => !current.has(g)),
    removed: live.group_ids.filter(g => !next.has(g)),
    kept: live.group_ids.filter(g => next.has(g)),
  };
}
export const diffIsEmpty = (d) => !d.time_changed && !d.space_changed && !d.title_changed && !d.added.length && !d.removed.length;

export function executionCapabilities(exec, today) {
  if (exec.state !== 'COMPLETED') return { editable: false, reason: 'יום הפעילות טרם נוצר במלואו. יש להשלים את היצירה במסך התכנון' };
  if (exec.management_state === 'CANCELLED') return { editable: false, reason: 'יום הפעילות בוטל' };
  if (exec.date < today) return { editable: false, reason: 'יום פעילות שעבר: לקריאה בלבד' };
  return { editable: true, reason: null };
}

// Compare-and-set query that starts an operation only if nobody changed the execution since it was read.
export function startOperationQuery(execId, expectedRevision) {
  const rev = expectedRevision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision: expectedRevision };
  return { id: execId, operation_id: { $in: [null, ''] }, ...rev };
}