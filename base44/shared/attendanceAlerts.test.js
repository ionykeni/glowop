import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttendanceAlerts, reminderWindow, recipientResolver, HOUR } from './attendanceAlertRules.js';
import { processAttendanceAlerts } from './attendanceAlertProcessor.js';
import { attendanceNotificationInbox } from './attendanceNotificationInbox.js';
import { entity } from './attendanceTestDb.js';
import { localToUtcMs } from './workScheduleReport.js';

const date = '2026-11-23';
const t = (time, day = date) => localToUtcMs(day, time);
const iso = (ms) => new Date(ms).toISOString();
const users = [{ id: 'mgr1', email: ' Shahaf@Glow-Glamping.com ' }, { id: 'mgr2', email: 'hospitality@glow-glamping.com' }, { id: 'staff', email: 'worker@example.com' }, { id: 'wrong', email: 'jkenigsberger@gmail.com' }];
const internals = [{ id: 'internal', email: 'worker@example.com', active: true, role: 'OPERATIONS' }];
const profile = { id: 'worker', full_name: 'עובד בדיקה', is_active: true, internal_user_id: 'internal' };
const schedule = { id: 'schedule', status: 'PUBLISHED' };
const shift = { id: 'shift01', date, work_schedule_id: 'schedule', worker_id: 'worker', status: 'PLANNED', start_time: '08:00', end_time: '16:00', row_type: 'OPERATIONS_MORNING' };
const session = (a, b, extra = {}) => ({ worker_profile_id: 'worker', status: b ? 'CLOSED' : 'ACTIVE', effective_start_at: iso(t(a)), ...(b ? { effective_end_at: iso(t(b)) } : {}), ...extra });
const events = (time, extra = {}) => buildAttendanceAlerts({ now: t(time), attendance: [], shifts: [shift], schedules: [schedule], profiles: [profile], users, internals, ...extra });
const kinds = (list) => list.map((e) => e.event_type);
const nine = (list) => list.filter((e) => e.event_type === 'NINE_HOURS');

test('nine hours: one active session and both exact recipient IDs; no duplicate account guessing', () => {
  assert.equal(nine(events('16:59', { attendance: [session('08:00')] })).length, 0);
  assert.deepEqual(nine(events('17:00', { attendance: [session('08:00')] })).map((x) => x.recipient_user_id), ['mgr1', 'mgr2']);
  assert.equal(recipientResolver([...users, { id: 'dupe', email: users[0].email }], internals).byEmail(users[0].email), null);
});

test('nine hours: multiple sessions, overlaps count once; voided and unreviewed sessions contribute nothing', () => {
  const records = [session('07:00', '12:00'), session('12:30', '16:30')];
  assert.equal(nine(events('16:30', { attendance: records })).length, 2);
  assert.equal(nine(events('16:00', { attendance: [...records, session('07:00', '12:00')] })).length, 0);
  for (const status of ['VOIDED', 'AUTO_CLOSED']) assert.equal(nine(events('16:30', { attendance: [records[0], { ...records[1], status, needs_review: true }] })).length, 0);
});

test('historical and newly backdated manager approvals are not live threshold crossings; pending requests do not alter records', () => {
  assert.equal(nine(events('17:00', { attendance: [session('06:00', '15:00', { last_corrected_at: iso(t('17:00')), source: 'MANUAL' })] })).length, 0);
  assert.equal(nine(events('17:00', { attendance: [session('06:00', '15:00', { effective_start_at: iso(t('06:00', '2026-11-22')), effective_end_at: iso(t('15:00', '2026-11-22')) })] })).length, 0);
  assert.equal(nine(events('17:00', { attendance: [session('08:00', '16:00')], corrections: [{ status: 'PENDING', requested_end_at: iso(t('17:00')) }] })).length, 0);
});

test('start: exact 15 minutes, delayed execution, early arrival, late resolved clock-in, multiple same-day shifts', () => {
  assert.deepEqual(kinds(events('08:14')), []);
  const [item] = events('08:15'); assert.equal(item.event_key, 'MISSED_CLOCK_IN|shift01|staff');
  assert.deepEqual(kinds(events('09:20')), ['MISSED_CLOCK_IN']);
  assert.deepEqual(kinds(events('10:20')), []);
  assert.deepEqual(kinds(events('08:15', { attendance: [session('07:20')] })), []);
  assert.deepEqual(kinds(events('09:00', { attendance: [session('08:30')] })), []);
  assert.deepEqual(kinds(events('16:45', { shifts: [shift, { ...shift, id: 'shift02', start_time: '16:30', end_time: '22:00' }], attendance: [session('07:55', '16:00')] })), ['MISSED_CLOCK_IN']);
});

test('end: still-active relevant session only, not an expired session, a closed session or next shift clock-in', () => {
  assert.deepEqual(kinds(events('16:14', { attendance: [session('08:00')] })), []);
  assert.deepEqual(kinds(events('16:15', { attendance: [session('08:00')] })), ['ACTIVE_AFTER_SHIFT_END']);
  assert.deepEqual(kinds(events('16:15', { attendance: [session('08:00', '16:05')] })), []);
  assert.deepEqual(kinds(events('16:15', { attendance: [session('16:05')] })), []);
  assert.equal(kinds(events('16:15', { attendance: [session('02:00')] })).includes('ACTIVE_AFTER_SHIFT_END'), false);
});

test('night duty, no times; invalid or unauthorized assignments are skipped', () => {
  const night = { ...shift, row_type: 'NIGHT_ON_CALL', start_time: '', end_time: '' };
  assert.deepEqual(kinds(events('20:59', { shifts: [night] })), []);
  assert.deepEqual(kinds(events('21:00', { shifts: [night] })), ['NIGHT_ON_CALL_21']);
  assert.deepEqual(kinds(events('21:30', { shifts: [{ ...night, status: 'CANCELLED' }] })), []);
  assert.deepEqual(kinds(events('21:30', { shifts: [night], schedules: [{ ...schedule, status: 'DRAFT' }] })), []);
  assert.deepEqual(kinds(events('21:30', { shifts: [{ ...night, worker_id: null }] })), []);
  assert.deepEqual(kinds(events('21:30', { shifts: [night], profiles: [{ ...profile, internal_user_id: null, email: internals[0].email }] })), []);
  assert.deepEqual(kinds(events('21:30', { shifts: [night], users: users.filter((u) => u.id !== 'staff') })), []);
});

test('overnight and DST use elapsed Jerusalem time: spring 4h, fall 6h; attendance splits at midnight', () => {
  for (const [day, hours] of [['2026-03-26', 4], ['2026-10-24', 6]]) {
    const { start, end } = reminderWindow({ date: day, start_time: '22:00', end_time: '03:00' });
    assert.equal(end - start, hours * HOUR);
  }
  assert.equal(reminderWindow({ date: '2026-03-27', start_time: '02:30', end_time: '04:00' }), null);
  const night = { ...shift, start_time: '22:00', end_time: '06:00' };
  assert.deepEqual(kinds(events('06:15', { now: t('06:15', '2026-11-24'), attendance: [session('21:55')], shifts: [night] })), ['ACTIVE_AFTER_SHIFT_END']);
  const overnight = session('22:00', null, { effective_start_at: iso(t('22:00', '2026-11-22')) });
  assert.equal(nine(events('08:59', { attendance: [overnight] })).length, 0);
  assert.equal(nine(events('09:00', { attendance: [overnight] })).length, 2);
});

function adapter(rows, name, readOnly = false) {
  const store = entity(rows, { name, readOnly });
  const legacy = store.filter;
  if (name === 'AttendanceNotification') {
    const create = store.create;
    store.create = (data) => create({ ...data, id: String(store.rows.length + 1).padStart(24, '0') });
  }
  store.filter = async (filter, sort, limit) => {
    if (!sort || typeof sort === 'string') return legacy(filter, sort, limit);
    const data = await legacy(filter, sort.sort, 1000);
    const offset = Number(sort.cursor || 0), items = data.slice(offset, offset + sort.limit);
    const next = offset + items.length;
    return { items, has_more: next < data.length, next_cursor: String(next) };
  };
  store.list = async (sort, limit, offset = 0) => (await legacy({}, sort)).slice(offset, offset + limit);
  return store;
}
const fakeDb = () => Object.fromEntries(Object.entries({ AttendanceNotification: [], AttendanceNotificationDelivery: [], AttendanceNotificationLock: [],
  AttendanceRecord: [], WorkShift: [shift], WorkSchedule: [schedule], WorkerProfile: [profile], User: users, InternalUser: internals,
}).map(([name, rows]) => [name, adapter([...rows], name, !name.startsWith('AttendanceNotification'))]));

test('simultaneous and later scans do not duplicate, and interrupted delivery bookkeeping is recovered', async () => {
  const db = fakeDb(), now = () => t('08:47');
  await Promise.all([processAttendanceAlerts(db, now), processAttendanceAlerts(db, now)]);
  assert.equal(db.AttendanceNotification.rows.length, 1);
  assert.equal(db.AttendanceNotificationDelivery.rows.length, 1);
  const attempt = db.AttendanceNotificationDelivery.rows[0];
  assert.equal(attempt.status, 'STORED');
  await db.AttendanceNotificationDelivery.update(attempt.id, { status: 'ATTEMPTED' });
  await processAttendanceAlerts(db, () => t('11:00'));
  assert.equal(db.AttendanceNotification.rows.length, 1);
  assert.equal(attempt.status, 'STORED');
});

test('recipient scope applies to list, mark read, archive, restore and bulk mutations', async () => {
  const db = fakeDb(), table = db.AttendanceNotification;
  await processAttendanceAlerts(db, () => t('08:47'));
  const [row] = table.rows;
  const inbox = (user, input) => attendanceNotificationInbox(table, user, input);
  assert.equal((await inbox(null, { action: 'list', folder: 'general' })).status, 401);
  assert.equal((await inbox('other', { action: 'list', folder: 'general', recipient_user_id: 'staff' })).items.length, 0);
  assert.equal((await inbox('other', { action: 'read', id: row.id })).status, 404);
  await inbox('other', { action: 'read_all' }); assert.equal(row.status, 'unread');
  await inbox('staff', { action: 'archive', id: row.id }); assert.equal(row.status, 'archived');
  await inbox('staff', { action: 'restore', id: row.id }); assert.equal(row.status, 'unread');
  await inbox('staff', { action: 'read', id: row.id }); assert.equal(row.status, 'read');
  await inbox('staff', { action: 'clear_read' }); assert.equal(row.status, 'archived');
  await inbox('staff', { action: 'restore', id: row.id }); assert.equal(row.status, 'read');
});