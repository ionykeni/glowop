// Phase C2 operations on a confirmed activity day (edit station / cancel station / cancel day).
// - Optimistic concurrency: an operation starts only via compare-and-set on (revision, no pending operation).
// - The pending operation is journaled on the execution; a retry with the same op_id resumes it idempotently.
// - Writes are serialized with C1 through the existing activity-day lease. Other booking modules do not take it,
//   so the room is re-checked once after writing and any race is reported (never silently ignored).
import { checkActivitySpaceConflict } from './activitySpaceAvailability.js';
import { json, fail } from './activityDayHttp.js';
import { acquireLock, releaseLock } from './activityDayLock.js';
import { isOpId, isStationActive, normalizeEditTarget, stationLiveState, diffIsEmpty, executionCapabilities, startOperationQuery } from './activityDayEdit.js';
import { parse, loadRows, rowsFor, groupNames, presentExecution, validateEdit, syncStation } from './activityDayManage.js';

export const failWith = (status, outcome, error, extra = {}) => fail(status, error, { outcome, ...extra });
export const getExec = (db, id) => db.ActivityDayExecution.get(id).catch(e => (e.status === 404 ? null : Promise.reject(e)));
const findStation = (stations, id) => stations.findIndex(s => s.station_id === id);
const liveOf = async (db, st) => stationLiveState(st, rowsFor(await loadRows(db, [st]), st));

async function prepareOperation(base44, db, exec, body, user) {
  const stations = parse(exec.stations_json, []);
  const base = { op_id: body.op_id, started_at: new Date().toISOString(), by: user.email };
  if (body.action === 'cancel_day') {
    const ids = stations.filter(isStationActive).map(s => s.station_id);
    if (!ids.length) return { error: failWith(409, 'INVALID', 'אין תחנות פעילות לביטול') };
    return { op: { ...base, type: 'CANCEL_DAY', station_ids: ids } };
  }
  const idx = findStation(stations, body.station_id);
  if (idx < 0 || !isStationActive(stations[idx])) return { error: failWith(404, 'INVALID', 'התחנה לא נמצאה או שכבר בוטלה') };
  if (body.action === 'cancel_station') return { op: { ...base, type: 'CANCEL_STATION', station_id: body.station_id } };

  const { target, errors } = normalizeEditTarget(body.target);
  if (errors.length) return { error: failWith(400, 'INVALID', errors[0], { errors }) };
  const station = stations[idx];
  const live = await liveOf(db, station);
  const v = await validateEdit(base44, db, exec, station, live, target);
  if (diffIsEmpty(v.diff)) return { error: failWith(400, 'NO_CHANGES', 'לא בוצעו שינויים בתחנה') };
  if (v.blockers.length) return { error: failWith(409, 'BLOCKED', 'לא ניתן לשמור — נמצאו חסימות', { blockers: v.blockers, warnings: v.warnings }) };
  const previous = { title: station.title || '', start_time: station.start_time, end_time: station.end_time, space_id: station.space_id, group_ids: live.group_ids };
  return { op: { ...base, type: 'EDIT', station_id: station.station_id, target, previous } };
}

// Applies (or re-applies) the journaled operation. Safe to call repeatedly: every step reads the current records.
async function perform(base44, db, exec, op, user, today, { direction = 'forward', revalidate = false } = {}) {
  const stations = parse(exec.stations_json, []);
  const at = new Date().toISOString();
  let postConflict = null;
  try {
    if (op.type === 'EDIT') {
      const target = direction === 'revert' ? op.previous : op.target;
      const idx = findStation(stations, op.station_id);
      if (revalidate) {
        const v = await validateEdit(base44, db, exec, stations[idx], await liveOf(db, stations[idx]), target);
        if (v.blockers.length) {
          return failWith(409, 'BLOCKED', direction === 'revert' ? 'לא ניתן לשחזר את המצב הקודם — נמצאו חסימות' : 'לא ניתן להשלים את השינוי — נמצאו חסימות',
            { blockers: v.blockers, execution: await presentExecution(db, exec, today) });
        }
      }
      const space = await db.ActivitySpace.get(target.space_id);
      const names = await groupNames(db, target.group_ids, stations);
      stations[idx] = await syncStation(db, exec, stations[idx], target, { space, names });
      const c = await checkActivitySpaceConflict(base44, { spaceId: target.space_id, date: exec.date, startTime: target.start_time, endTime: target.end_time, excludeSharedActivityId: stations[idx].shared_activity_id });
      if (c) postConflict = `${c.message}${c.conflicting_title ? ` — ${c.conflicting_title}` : ''}`;
    } else {
      const ids = op.type === 'CANCEL_DAY' ? op.station_ids : [op.station_id];
      for (const sid of ids) {
        const idx = findStation(stations, sid);
        const done = await syncStation(db, exec, stations[idx], null);
        stations[idx] = { ...done, status: 'CANCELLED', cancelled_at: done.cancelled_at || at, cancelled_by: done.cancelled_by || user.email };
        await db.ActivityDayExecution.update(exec.id, { stations_json: JSON.stringify(stations) }); // progress survives interruption
      }
    }
  } catch (err) {
    console.error('[activityDayOperations] apply failed', op.type, err?.code, err?.message);
    await db.ActivityDayExecution.update(exec.id, { management_state: 'NEEDS_RECOVERY', last_error: String(err?.message || 'שגיאת כתיבה').slice(0, 500), stations_json: JSON.stringify(stations) }).catch(() => {});
    const fresh = await getExec(db, exec.id);
    return failWith(500, 'PARTIAL', 'השינוי הושלם חלקית — נדרשת השלמה או שחזור', { execution: await presentExecution(db, fresh, today) });
  }
  const history = [...parse(exec.history_json, []), {
    op_id: op.op_id, type: direction === 'revert' ? 'EDIT_REVERTED' : op.type, station_id: op.station_id || null,
    station_ids: op.station_ids || null, target: op.target || null, previous: op.previous || null, at, by: user.email, post_conflict: postConflict,
  }].slice(-200);
  const allCancelled = stations.every(s => !isStationActive(s));
  await db.ActivityDayExecution.update(exec.id, {
    stations_json: JSON.stringify(stations), history_json: JSON.stringify(history), operation_id: '', operation_json: '',
    management_state: allCancelled ? 'CANCELLED' : 'ACTIVE', last_modified_at: at, last_modified_by: user.email, last_error: '',
  });
  const fresh = await getExec(db, exec.id);
  return json({ success: true, outcome: 'COMPLETED', post_conflict: postConflict, execution: await presentExecution(db, fresh, today) });
}

async function withLock(db, key, fn) {
  const lockId = await acquireLock(db, key);
  if (!lockId) return failWith(409, 'BUSY', 'פעולה אחרת על ימי פעילות מתבצעת כעת — נסה שוב בעוד רגע', { retryable: true });
  try { return await fn(); } finally { await releaseLock(db, lockId, key); }
}

export async function commit(base44, db, execId, body, user, today) {
  if (!isOpId(body.op_id)) return failWith(400, 'INVALID', 'מזהה פעולה חסר או לא תקין');
  if (body.confirmed !== true) return failWith(400, 'NOT_CONFIRMED', 'נדרש אישור מפורש');
  return withLock(db, body.op_id, async () => {
    const exec = await getExec(db, execId);
    if (!exec) return failWith(404, 'INVALID', 'יום הפעילות לא נמצא');
    if (parse(exec.history_json, []).some(h => h.op_id === body.op_id)) {
      return json({ success: true, outcome: 'COMPLETED', replay: true, execution: await presentExecution(db, exec, today) });
    }
    if (exec.operation_id) {
      if (exec.operation_id !== body.op_id) return failWith(409, 'OPERATION_PENDING', 'פעולה קודמת על יום פעילות זה לא הושלמה. יש להשלים או לשחזר אותה תחילה', { execution: await presentExecution(db, exec, today) });
      return perform(base44, db, exec, parse(exec.operation_json, {}), user, today, { revalidate: true }); // retry of the same operation
    }
    const caps = executionCapabilities(exec, today);
    if (!caps.editable) return failWith(409, 'READ_ONLY', caps.reason);
    const rev = exec.revision ?? 0;
    if (rev !== body.expected_revision) return failWith(409, 'STALE', 'יום הפעילות שונה בינתיים על ידי משתמש אחר — יש לרענן', { execution: await presentExecution(db, exec, today) });

    const { op, error } = await prepareOperation(base44, db, exec, body, user);
    if (error) return error;
    const res = await db.ActivityDayExecution.updateMany(startOperationQuery(exec.id, rev), {
      $set: { revision: rev + 1, management_state: 'UPDATING', operation_id: op.op_id, operation_json: JSON.stringify(op), last_error: '' },
    });
    if (res?.updated !== 1) return failWith(409, 'STALE', 'יום הפעילות שונה בינתיים על ידי משתמש אחר — יש לרענן');
    return perform(base44, db, await getExec(db, exec.id), op, user, today);
  });
}

export async function resume(base44, db, execId, body, user, today) {
  const direction = body.direction === 'revert' ? 'revert' : 'forward';
  if (!isOpId(body.op_id)) return failWith(400, 'INVALID', 'מזהה פעולה חסר או לא תקין');
  return withLock(db, body.op_id, async () => {
    const exec = await getExec(db, execId);
    if (!exec) return failWith(404, 'INVALID', 'יום הפעילות לא נמצא');
    if (exec.operation_id !== body.op_id) return failWith(409, 'STALE', 'אין פעולה ממתינה זו — יש לרענן', { execution: await presentExecution(db, exec, today) });
    const op = parse(exec.operation_json, {});
    if (direction === 'revert' && op.type !== 'EDIT') return failWith(400, 'INVALID', 'ניתן לשחזר רק עריכה. ביטול ניתן רק להשלים');
    return perform(base44, db, exec, op, user, today, { direction, revalidate: true });
  });
}

export async function previewEdit(base44, db, exec, body, today) {
  const caps = executionCapabilities(exec, today);
  if (!caps.editable) return failWith(409, 'READ_ONLY', caps.reason);
  const stations = parse(exec.stations_json, []);
  const idx = findStation(stations, body.station_id);
  if (idx < 0 || !isStationActive(stations[idx])) return failWith(404, 'INVALID', 'התחנה לא נמצאה או שכבר בוטלה');
  const { target, errors } = normalizeEditTarget(body.target);
  if (errors.length) return failWith(400, 'INVALID', errors[0], { errors });
  const station = stations[idx];
  const v = await validateEdit(base44, db, exec, station, await liveOf(db, station), target);
  const names = { ...(await groupNames(db, [...v.diff.kept, ...v.diff.removed], stations)), ...v.names };
  const label = (ids) => ids.map(id => ({ group_id: id, group_name: names[id] || 'קבוצה' }));
  return json({
    success: true, preview_only: true, revision: exec.revision ?? 0, blockers: v.blockers, warnings: v.warnings,
    no_changes: diffIsEmpty(v.diff), space_name: v.space_name, target,
    diff: { ...v.diff, added: label(v.diff.added), removed: label(v.diff.removed), kept: label(v.diff.kept) },
    checked_at: new Date().toISOString(),
  });
}

export async function previewCancel(db, exec, body, today) {
  const caps = executionCapabilities(exec, today);
  if (!caps.editable) return failWith(409, 'READ_ONLY', caps.reason);
  const stations = parse(exec.stations_json, []).filter(isStationActive).filter(s => !body.station_id || s.station_id === body.station_id);
  if (!stations.length) return failWith(404, 'INVALID', 'אין תחנות פעילות לביטול');
  const rows = await loadRows(db, stations);
  const names = await groupNames(db, rows.map(r => r.group_id), stations);
  const out = stations.map(st => {
    const live = stationLiveState(st, rowsFor(rows, st));
    return { station_id: st.station_id, title: st.title, start_time: st.start_time, end_time: st.end_time, space_name: st.space_name, groups: live.group_ids.map(g => names[g] || 'קבוצה'), items: live.active.length };
  });
  return json({ success: true, revision: exec.revision ?? 0, date: exec.date, template_name: exec.template_name, template_version: exec.template_version, stations: out, total_items: out.reduce((n, s) => n + s.items, 0) });
}