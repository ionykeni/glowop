import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { resolveInternalRole } from '../../shared/internalRoleAuth.js';
import { todayInJerusalem } from '../../shared/activityCreationWindow.js';
import { isId } from '../../shared/activityDayPlanData.js';
import { json } from '../../shared/activityDayHttp.js';
import { ACTIVITY_CALENDAR_ID } from '../../shared/activityCalendar.js';
import { compareEvent, cancelledItemState } from '../../shared/activityDayCalendarCheck.js';
import { parse, loadRows, groupNames, summarizeExecution, presentExecution } from '../../shared/activityDayManage.js';
import { failWith, getExec, commit, resume, previewEdit, previewCancel } from '../../shared/activityDayOperations.js';

// Phase C2: manage confirmed activity days (C1 executions only): edit a station, cancel a station, cancel the day.
// - Existing GroupScheduleItems are updated in place (same shared_activity_id); one record per call, so the
//   existing "Sync Common Spaces to Google Calendar" workflow mirrors every change. No direct calendar writes here.
// - Concurrency, idempotency and recovery live in shared/activityDayOperations.js.
const ALLOWED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

// Evidence only: reads each mirrored event from Google and compares it with the app record. Never writes.
async function verifyCalendar(base44, db, exec) {
  const stations = parse(exec.stations_json, []);
  const rows = (await loadRows(db, stations)).slice(0, 300);
  const syncs = rows.length ? await db.CalendarSync.filter({ group_schedule_item_id: { $in: rows.map(r => r.id) } }, 'created_date', 2000) : [];
  const syncByItem = {};
  for (const s of syncs) (syncByItem[s.group_schedule_item_id] ||= []).push(s);
  const spaces = Object.fromEntries((await db.ActivitySpace.list('name', 500)).map(s => [s.id, s.name || s.code]));
  const names = await groupNames(db, rows.map(r => r.group_id), stations);
  const titleByShared = Object.fromEntries(stations.map(s => [s.shared_activity_id, s.title]));
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');

  const checkOne = async (r) => {
    const base = { item_id: r.id, group_name: names[r.group_id] || 'קבוצה', station_title: titleByShared[r.shared_activity_id] || r.activity_name, status: r.status, start_time: r.start_time, end_time: r.end_time, space_name: spaces[r.activity_space_id] || '' };
    const list = syncByItem[r.id] || [];
    if (r.status !== 'ACTIVE') return { ...base, ...cancelledItemState(list.length > 0) };
    if (!list.length) return { ...base, state: 'NO_SYNC_RECORD', details: 'טרם נוצר אירוע ביומן Google (ייתכן שהסנכרון עדיין רץ)' };
    const sr = list[0];
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(sr.calendar_id || ACTIVITY_CALENDAR_ID)}/events/${encodeURIComponent(sr.calendar_event_id)}?timeZone=Asia%2FJerusalem`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
    if (res.status === 404 || res.status === 410) return { ...base, ...compareEvent(r, null, base.space_name) };
    if (!res.ok) return { ...base, state: 'GOOGLE_ERROR', details: `Google החזיר ${res.status}` };
    const out = { ...base, ...compareEvent(r, await res.json(), base.space_name) };
    return list.length > 1 ? { ...out, state: 'MISMATCH', details: [out.details, 'קיימים כמה אירועים לאותה פעילות'].filter(Boolean).join(' · ') } : out;
  };
  const items = [];
  for (let i = 0; i < rows.length; i += 6) {
    const batch = await Promise.allSettled(rows.slice(i, i + 6).map(checkOne));
    batch.forEach((b, j) => items.push(b.status === 'fulfilled' ? b.value : { item_id: rows[i + j].id, state: 'GOOGLE_ERROR', details: String(b.reason?.message || 'שגיאה') }));
  }
  const counts = items.reduce((m, it) => ({ ...m, [it.state]: (m[it.state] || 0) + 1 }), {});
  return json({ success: true, checked_at: new Date().toISOString(), counts, items, all_ok: items.every(it => it.state === 'OK' || it.state === 'REMOVED') });
}

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me().catch(e => (e.status === 401 || e.status === 403 ? null : Promise.reject(e)));
    if (!user) return failWith(401, 'UNAUTHORIZED', 'נדרשת התחברות');
    const role = await resolveInternalRole(base44, user);
    if (!ALLOWED_ROLES.has(role)) return failWith(403, 'FORBIDDEN', 'אין הרשאה לניהול ימי פעילות');

    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;
    const today = todayInJerusalem();

    if (body.action === 'list') {
      const rows = await db.ActivityDayExecution.list('-date', 300);
      return json({ success: true, today, executions: rows.map(e => summarizeExecution(e, today)) });
    }
    if (!isId(body.execution_id)) return failWith(400, 'INVALID', 'חסר מזהה יום פעילות');
    if (['commit_edit', 'cancel_station', 'cancel_day'].includes(body.action)) {
      return await commit(base44, db, body.execution_id, body, user, today);
    }
    if (body.action === 'resume') return await resume(base44, db, body.execution_id, body, user, today);

    const exec = await getExec(db, body.execution_id);
    if (!exec) return failWith(404, 'INVALID', 'יום הפעילות לא נמצא');
    if (body.action === 'get') return json({ success: true, today, execution: await presentExecution(db, exec, today, { withDayGroups: true }) });
    if (body.action === 'preview_edit') return await previewEdit(base44, db, exec, body, today);
    if (body.action === 'preview_cancel') return await previewCancel(db, exec, body, today);
    if (body.action === 'verify_calendar') return await verifyCalendar(base44, db, exec);
    return failWith(400, 'INVALID', 'פעולה לא מוכרת');
  } catch (err) {
    console.error('[manageActivityDayExecutions]', err?.message, err?.stack);
    return failWith(500, 'ERROR', 'שגיאה פנימית — יש לרענן ולבדוק את מצב יום הפעילות לפני ניסיון חוזר');
  }
}