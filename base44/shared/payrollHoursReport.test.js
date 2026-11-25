import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localToUtcMs } from './workScheduleReport.js';
import { payrollRange } from './payrollHoursCalendar.js';
import { buildPayrollHoursReport } from './payrollHoursReport.js';

const H = 3_600_000;
const profile = { id: 'worker1', full_name: 'עובד בדיקה' };
const now = Date.parse('2026-12-29T18:00:00Z');
const at = (date, time) => new Date(localToUtcMs(date, time)).toISOString();
const rec = (id, date, start, end, extra = {}) => ({ id, worker_profile_id: profile.id, status: 'CLOSED', local_date: date,
  effective_start_at: at(date, start), effective_end_at: end ? at(end <= start ? addDays(date, 1) : date, end) : null, ...extra });
const request = (overrides = {}) => ({ id: 'request1', worker_profile_id: profile.id, status: 'PENDING', request_type: 'EDIT', local_date: '2026-11-08', ...overrides });
const arrangement = (weekly, limits, extra = {}) => ({ worker_profile_id: profile.id, effective_from: '2026-11-01', effective_through: '2026-12-31',
  rule: 'IL_SECTION_16_SUN_SAT', inputs_verified: true, review_reference: 'Fixture – reviewed arrangements are not production defaults',
  weekly_regular_minutes: weekly, daily_limits: Object.entries(limits).map(([date, regular_minutes]) => ({ date, regular_minutes })), special_windows: [], ...extra });
const run = (records, opts = {}) => buildPayrollHoursReport({ records, requests: [], arrangements: [], profiles: [profile], range: payrollRange('2026-11'), now, ...opts }).workers[0];

test('multiple sessions retain both clock entries; gaps are not counted as work', () => {
  const w = run([rec('first', '2026-11-08', '08:00', '12:00'), rec('second', '2026-11-08', '13:00', '17:30')]);
  assert.equal(w.hours.verified, 8.5 * H);
  assert.equal(w.worked_days, 1);
  assert.deepEqual(w.days[0].rows.map((r) => [r.id, r.session_ms]), [['first', 4 * H], ['second', 4.5 * H]]);
  assert.equal(w.legal.unresolved, 8.5 * H);
});

test('overnight splits at Israel midnight and month boundary without losing original clock times', () => {
  const record = rec('night', '2026-11-30', '22:00', '04:00');
  const nov = run([record]), dec = run([record], { range: payrollRange('2026-12') });
  assert.deepEqual([nov.hours.verified, dec.hours.verified], [2 * H, 4 * H]);
  assert.deepEqual([nov.days[0].date, dec.days[0].date], ['2026-11-30', '2026-12-01']);
  assert.equal(dec.days[0].rows[0].start_at, record.effective_start_at);
  assert.equal(dec.days[0].rows[0].session_ms, 6 * H);
  assert.ok(dec.review_weeks[0].reasons.includes('NIGHT'));
});

test('overnight crossing Saturday/Sunday flags both legal weeks; DST uses elapsed real time', () => {
  const night = rec('night', '2026-11-07', '23:00', '04:00');
  const w = run([night]);
  assert.deepEqual(w.review_weeks.map((x) => x.week), ['2026-11-01', '2026-11-08']);
  assert.equal(w.hours.verified, 5 * H);
  const dst = rec('dst', '2026-10-25', '00:30', '03:30');
  assert.equal(run([dst], { range: payrollRange('2026-10') }).hours.verified, 4 * H);
});

test('overlaps are unioned across records and statuses; no bucket gets the same minute twice', () => {
  const records = [rec('v1', '2026-11-08', '09:00', '12:00'), rec('v2', '2026-11-08', '11:00', '14:00'),
    rec('unverified', '2026-11-08', '07:00', '10:00', { status: 'AUTO_CLOSED', needs_review: true })];
  const w = run(records);
  assert.deepEqual(w.hours, { verified: 5 * H, unverified: 2 * H, active: 0, pending: 0 });
  assert.ok(w.days[0].rows.every((r) => r.overlap));
  assert.equal(w.legal.unresolved, 5 * H);
});

test('official applied correction supersedes original times; an approved request is not counted again', () => {
  const record = rec('edited', '2026-11-08', '08:00', '14:00', { is_corrected: true, clock_out_at: at('2026-11-08', '12:00') });
  const w = run([record, rec('voided', '2026-11-08', '15:00', '18:00', { status: 'VOIDED' })], { requests: [request({ status: 'APPROVED', attendance_record_id: 'edited' })] });
  assert.equal(w.hours.verified, 6 * H);
  assert.equal(w.days[0].rows[0].end_at, record.effective_end_at);
  assert.equal(w.days[0].rows[0].corrected, true);
  assert.equal(w.pending_count, 0);
});

test('active, missing, auto-closed, pending edit and in-flight add are separate from verified time', () => {
  const d = '2026-11-08';
  const records = [rec('v', d, '07:00', '08:00'), rec('edit', d, '08:00', '09:00'), rec('add', d, '09:00', '10:00', { manual_request_id: 'APPROVE|decision' }),
    rec('auto', d, '10:00', '11:00', { status: 'AUTO_CLOSED', needs_review: true }), rec('missing', d, '11:00', null),
    rec('active', d, '13:00', null, { status: 'ACTIVE', auto_close_due_at: at('2026-11-09', '02:00') })];
  const requests = [request({ attendance_record_id: 'edit', requested_start_at: at(d, '05:00'), requested_end_at: at(d, '07:00') }),
    request({ id: 'request2', status: 'APPROVING', request_type: 'ADD', decision_key: 'decision' }),
    request({ id: 'request3', request_type: 'ADD', requested_start_at: at(d, '05:00'), requested_end_at: at(d, '06:00') })];
  const w = run(records, { requests, now: localToUtcMs(d, '15:00') });
  assert.deepEqual(w.hours, { verified: H, active: 2 * H, unverified: H, pending: 2 * H });
  assert.equal(w.pending_count, 3);
  assert.equal(w.days[0].rows.find((r) => r.id === 'active').end_at, null);
  assert.equal(w.days[0].rows.find((r) => r.id === 'missing').counted_ms, null);
});

test('weekly threshold includes verified hours before the month, not after it or after a new week', () => {
  const limit = arrangement(16 * 60, { '2026-11-29': 480, '2026-11-30': 480, '2026-12-01': 480, '2026-12-06': 480 });
  const w = run([rec('a', '2026-11-29', '08:00', '16:00'), rec('b', '2026-11-30', '08:00', '16:00'),
    rec('c', '2026-12-01', '08:00', '11:00'), rec('d', '2026-12-06', '08:00', '11:00')], { arrangements: [limit], range: payrollRange('2026-12') });
  assert.deepEqual([w.hours.verified, w.legal.regular, w.legal.overtime125, w.legal.overtime150], [6 * H, 3 * H, 2 * H, H]);
});

test('daily overtime is not applied again to weekly quota; combined overtime tiers reset daily', () => {
  const d = '2026-11-08', n = '2026-11-09';
  const p = arrangement(900, { [d]: 480, [n]: 480 });
  const w = run([rec('a', d, '08:00', '19:00'), rec('b', n, '08:00', '17:00')], { arrangements: [p] });
  assert.deepEqual([w.legal.regular, w.legal.overtime125, w.legal.overtime150, w.legal.unresolved], [15 * H, 4 * H, H, 0]);
});

test('a reviewed 42-hour week counts only the extra 3 hours over 42, using the applicable daily limits', () => {
  const records = Array.from({ length: 6 }, (_, i) => rec(`day${i}`, addDays('2026-11-08', i), '08:00', i === 5 ? '13:00' : '16:00'));
  const p = arrangement(2520, Object.fromEntries(records.map((r) => [r.local_date, 480])));
  const w = run(records, { arrangements: [p] });
  assert.deepEqual([w.legal.regular, w.legal.overtime125, w.legal.overtime150], [42 * H, 2 * H, H]);
});

test('exact reviewed weekly-rest and holiday windows categorize distinct portions, without guessing premiums', () => {
  const d = '2026-11-08', record = rec('work', d, '08:00', '14:00');
  const p = arrangement(2520, { [d]: 480 }, { special_windows: [
    { kind: 'weekly_rest', start_at: at(d, '08:00'), end_at: at(d, '11:00') },
    { kind: 'holiday', start_at: at(d, '10:00'), end_at: at(d, '13:00') },
  ] });
  const w = run([record], { arrangements: [p] });
  assert.deepEqual([w.legal.weekly_rest, w.legal.holiday, w.legal.unresolved], [2 * H, 2 * H, 2 * H]);
  assert.ok(w.review_weeks[0].reasons.includes('SPECIAL'));
  assert.equal(Object.values(w.legal).reduce((a, b) => a + b), w.hours.verified);
});

test('missing, unreviewed or conflicting configuration, work at night, and pending changes fail closed', () => {
  const d = '2026-11-08', p = arrangement(2520, { [d]: 480 });
  const record = rec('a', d, '08:00', '17:00');
  for (const configs of [[], [p, p], [{ ...p, inputs_verified: false }], [{ ...p, daily_limits: [] }], [{ ...p, effective_from: '2026-11-09' }]]) {
    assert.equal(run([record], { arrangements: configs }).legal.unresolved, 9 * H);
  }
  assert.equal(run([rec('night', d, '01:00', '10:00')], { arrangements: [p] }).legal.unresolved, 9 * H);
  const pending = request({ requested_start_at: at('2026-11-10', '08:00'), requested_end_at: at('2026-11-10', '10:00') });
  assert.equal(run([record], { arrangements: [p], requests: [pending] }).legal.unresolved, 9 * H);
});