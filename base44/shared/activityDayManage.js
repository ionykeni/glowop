// Phase C2 datastore layer for confirmed activity days: load live state, validate edits, apply changes.
// All GroupScheduleItem writes are single-record calls so the existing calendar workflow fires per record.
import { isId, LOGISTICS_KEYS, loadGroupsForDay, buildPreview } from './activityDayPlanData.js';
import { stationGroupCheck } from './activityDayPlanning.js';
import { checkActivitySpaceConflict } from './activitySpaceAvailability.js';
import { isGroupDeparted } from './activityCreationWindow.js';
import { buildScheduleItemPayload, HARD_STATUSES } from './activityDayExecution.js';
import {
  stationLiveState, desiredItemFields, planStationApply, planIsEmpty, applyStationPlan, itemsMap,
  stationSnapshot, editDiff, isStationActive, executionCapabilities,
} from './activityDayEdit.js';

export const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
export const codeError = (code, message) => Object.assign(new Error(message), { code });

export async function loadRows(db, stations) {
  const shared = stations.map(s => s.shared_activity_id).filter(Boolean);
  const rows = shared.length ? await db.GroupScheduleItem.filter({ shared_activity_id: { $in: shared } }, 'created_date', 5000) : [];
  const known = new Set(rows.map(r => r.id));
  const journalIds = [...new Set(stations.flatMap(s => Object.values(s.items || {})))].filter(id => isId(id) && !known.has(id));
  const extra = journalIds.length ? await db.GroupScheduleItem.filter({ id: { $in: journalIds } }, 'created_date', 2000) : [];
  return [...rows, ...extra];
}
export const rowsFor = (rows, st) => {
  const ids = new Set(Object.values(st.items || {}));
  return rows.filter(r => r.shared_activity_id === st.shared_activity_id || ids.has(r.id));
};

export async function groupNames(db, ids, stations) {
  const names = {};
  for (const s of stations) for (const g of s.groups || []) names[g.group_id] = g.group_name;
  const missing = [...new Set(ids)].filter(id => isId(id) && !names[id]);
  if (missing.length) for (const g of await db.Group.filter({ id: { $in: missing } }, 'group_name', 1000)) names[g.id] = g.group_name;
  return names;
}

export function summarizeExecution(exec, today) {
  const stations = parse(exec.stations_json, []);
  const active = stations.filter(isStationActive);
  return {
    id: exec.id, template_name: exec.template_name, template_version: exec.template_version, template_id: exec.template_id,
    date: exec.date, state: exec.state, management_state: exec.management_state || 'ACTIVE',
    station_count: stations.length, active_station_count: active.length,
    group_names: [...new Set(active.flatMap(s => (s.groups || []).map(g => g.group_name)))],
    last_modified_at: exec.last_modified_at || exec.completed_at || exec.updated_date,
    pending_operation: !!exec.operation_id, capabilities: executionCapabilities(exec, today),
  };
}

export async function presentExecution(db, exec, today, { withDayGroups = false } = {}) {
  const stations = parse(exec.stations_json, []);
  const rows = await loadRows(db, stations);
  const names = await groupNames(db, rows.map(r => r.group_id), stations);
  const activeIds = rows.filter(r => r.status === 'ACTIVE').map(r => r.id);
  const syncs = activeIds.length ? await db.CalendarSync.filter({ group_schedule_item_id: { $in: activeIds } }, 'created_date', 5000) : [];
  const synced = new Set(syncs.map(s => s.group_schedule_item_id));
  const capabilities = executionCapabilities(exec, today);
  return {
    ...summarizeExecution(exec, today),
    execution_key: exec.execution_key, revision: exec.revision ?? 0, last_modified_by: exec.last_modified_by || exec.actor_email || null,
    last_error: exec.last_error || null,
    operation: exec.operation_id ? parse(exec.operation_json, null) : null,
    history: parse(exec.history_json, []).slice(-30).reverse(),
    calendar_sync: { observed: synced.size, total_active: activeIds.length },
    stations: stations.map(st => {
      const live = stationLiveState(st, rowsFor(rows, st));
      return {
        station_id: st.station_id, title: st.title, status: isStationActive(st) ? 'ACTIVE' : 'CANCELLED',
        start_time: st.start_time, end_time: st.end_time, space_id: st.space_id, space_name: st.space_name,
        shared_activity_id: st.shared_activity_id, logistics: st.logistics || {}, edited: !!st.original,
        cancelled_at: st.cancelled_at || null, cancelled_by: st.cancelled_by || null,
        groups: live.group_ids.map(gid => ({ group_id: gid, group_name: names[gid] || 'קבוצה', item_id: live.activeByGroup[gid][0].id, synced: synced.has(live.activeByGroup[gid][0].id) })),
        original_groups: st.groups.map(g => ({ group_id: g.group_id, group_name: g.group_name })),
        live_shapes: [...new Set(live.active.map(r => `${r.start_time}–${r.end_time}`))],
        out_of_sync: live.out_of_sync, duplicates: live.duplicates, detached: live.detached.length,
      };
    }),
    day_groups: withDayGroups && capabilities.editable ? await loadGroupsForDay(db, exec.date) : [],
  };
}

// Backend revalidation of an edit. Added groups get the Phase B date-only rules; kept groups are preserved as-is.
export async function validateEdit(base44, db, exec, station, live, target) {
  const blockers = [], warnings = [];
  if (live.detached.length) blockers.push('חלק מהפעילויות של התחנה נותקו מהפעילות המשותפת מחוץ למסך זה. לא ניתן לערוך את התחנה בבטחה');
  const diff = editDiff(station, live, target);
  const dayGroups = await loadGroupsForDay(db, exec.date);
  const byId = Object.fromEntries(dayGroups.map(g => [g.id, g]));

  const profiles = diff.added.length ? await db.OperationalGroupProfile.filter({ group_id: { $in: diff.added } }, 'created_date', 2000) : [];
  const hasProfile = new Set(profiles.map(p => p.group_id));
  for (const gid of diff.added) {
    const g = byId[gid];
    const check = stationGroupCheck(g?.presence);
    if (!g || !check.ok) blockers.push(`${g?.group_name || 'קבוצה'}: ${check.message || 'הקבוצה אינה שוהה באתר בתאריך זה'}`);
    else if (isGroupDeparted(g)) blockers.push(`הקבוצה "${g.group_name}" כבר עזבה את האתר`);
    else if (!hasProfile.has(gid)) blockers.push(`לא נמצא פרופיל תפעולי לקבוצה "${g.group_name}"`);
  }
  if (diff.kept.length) {
    const kept = await db.Group.filter({ id: { $in: diff.kept } }, 'group_name', 1000);
    if (kept.length !== diff.kept.length) blockers.push('אחת הקבוצות המשתתפות לא נמצאה. יש להסיר אותה מהתחנה במפורש');
    for (const g of kept) if (g.status === 'CANCELLED' || g.cancellation_operation_id) blockers.push(`הקבוצה "${g.group_name}" בוטלה. יש להסיר אותה מהתחנה במפורש`);
  }

  // Physical space: same engine as Phase B, excluding only this station's own shared activity.
  const planStation = { station_id: station.station_id, title: target.title, start_time: target.start_time, end_time: target.end_time, space_id: target.space_id, groups: [], ...(station.logistics || {}) };
  const [res] = await buildPreview(db, exec.date, [planStation], byId, new Set([station.shared_activity_id]));
  for (const issue of res.issues) {
    if (issue.code === 'NO_GROUPS') continue;
    if (issue.status === 'PENDING') warnings.push(issue.message);
    else if (HARD_STATUSES.has(issue.status)) blockers.push(issue.message);
  }
  const conflict = await checkActivitySpaceConflict(base44, {
    spaceId: target.space_id, date: exec.date, startTime: target.start_time, endTime: target.end_time, excludeSharedActivityId: station.shared_activity_id,
  });
  if (conflict) blockers.push(`${conflict.message}${conflict.conflicting_title ? ` — ${conflict.conflicting_title} (${conflict.start_time || ''}–${conflict.end_time || ''})` : ''}`);
  const names = Object.fromEntries(dayGroups.map(g => [g.id, g.group_name]));
  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)], diff, space_name: res.space_name, names };
}

// Brings one station's records to `target` (null = cancel every participating item). Idempotent and verified.
export async function syncStation(db, exec, station, target, ctx = {}) {
  const live = stationLiveState(station, rowsFor(await loadRows(db, [station]), station));
  if (live.detached.length) throw codeError('DETACHED', 'חלק מהפעילויות של התחנה נותקו מהפעילות המשותפת');
  const working = target ? {
    ...station, title: target.title, start_time: target.start_time, end_time: target.end_time,
    space_id: target.space_id, space_name: ctx.space.name, space_code: ctx.space.code || null,
    groups: target.group_ids.map(id => ({ group_id: id, group_name: ctx.names[id] || id })),
  } : station;
  const desired = target ? desiredItemFields(exec, working, target, ctx.names) : null;
  const plan = planStationApply(live, target, desired);

  const profiles = {};
  if (plan.creates.length) {
    for (const p of await db.OperationalGroupProfile.filter({ group_id: { $in: plan.creates } }, 'created_date', 2000)) profiles[p.group_id] ||= p.id;
    const missing = plan.creates.find(g => !profiles[g]);
    if (missing) throw codeError('NO_PROFILE', `לא נמצא פרופיל תפעולי לקבוצה "${ctx.names[missing] || missing}"`);
  }
  await applyStationPlan(plan, {
    updateItem: (id, patch) => db.GroupScheduleItem.update(id, patch),
    createItem: (gid) => db.GroupScheduleItem.create(buildScheduleItemPayload({ station: working, groupId: gid, profileId: profiles[gid], execution: exec, logisticsKeys: LOGISTICS_KEYS })),
    cancelItem: (id) => db.GroupScheduleItem.update(id, { status: 'CANCELLED' }),
  });

  const after = stationLiveState(working, rowsFor(await loadRows(db, [station]), station));
  if (!planIsEmpty(planStationApply(after, target, desired))) throw codeError('VERIFY_FAILED', 'האימות לאחר השמירה נכשל');
  return { ...working, items: target ? itemsMap(after) : station.items, original: station.original || stationSnapshot(station) };
}