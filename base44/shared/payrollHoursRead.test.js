import test from 'node:test';
import assert from 'node:assert/strict';
import { servePayrollHours } from './payrollHoursRead.js';

const email = 'payroll-fixture@example.test';
const req = (body, authorized = true) => new Request('https://app.example.test/', { method: 'POST',
  headers: authorized ? { Authorization: 'Bearer test' } : {}, body: JSON.stringify(body) });

function client(role, { active = true, signedIn = true } = {}) {
  const reads = [];
  const entities = new Proxy({
    InternalUser: { list: async () => role ? [{ email, role, active }] : [] },
    WorkerProfile: { filter: async () => ({ items: [{ id: '1234567890abcdef12345678', full_name: 'עובד בדיקה', email }], has_more: false }) },
    AttendanceRecord: { filter: async () => ({ items: [], has_more: false }) },
    AttendanceCorrectionRequest: { filter: async () => ({ items: [], has_more: false }) },
    PayrollHoursArrangement: { filter: async () => ({ items: [], has_more: false }) },
  }, { get(target, key) { reads.push(key); return target[key]; } });
  return { reads, auth: { me: async () => signedIn ? { email, role: 'admin' } : null }, asServiceRole: { entities } };
}

test('anonymous, inactive, non-manager and platform-admin-only callers cannot read payroll data', async () => {
  let db = client('ADMIN');
  assert.equal((await servePayrollHours(db, req({ month: '2026-11' }, false))).status, 401);
  assert.deepEqual(db.reads, []);
  db = client('ADMIN', { signedIn: false });
  assert.equal((await servePayrollHours(db, req({ month: '2026-11' }))).status, 401);
  assert.deepEqual(db.reads, []);
  for (const nonManager of [client('OPERATIONS'), client(null), client('ADMIN', { active: false })]) {
    assert.equal((await servePayrollHours(nonManager, req({ month: '2026-11', role: 'ADMIN' }))).status, 403);
    assert.equal((await servePayrollHours(nonManager, req({ action: 'directory' }))).status, 403);
    assert.ok(nonManager.reads.every((read) => read === 'InternalUser'));
  }
});

test('verified ADMIN and SUPER_ADMIN can read; reports are non-cacheable and directory strips contact data', async () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN']) {
    const db = client(role);
    const report = await servePayrollHours(db, req({ month: '2026-11', worker_id: '1234567890abcdef12345678' }));
    assert.equal(report.status, 200);
    assert.equal(report.headers.get('Cache-Control'), 'private, no-store');
    const body = await report.json();
    assert.equal(body.payroll_ready, false);
    assert.equal(body.workers.length, 1);
    assert.equal(body.workers[0].hours.verified, 0);
    const directory = await (await servePayrollHours(db, req({ action: 'directory' }))).json();
    assert.deepEqual(directory.workers, [{ id: '1234567890abcdef12345678', full_name: 'עובד בדיקה' }]);
  }
});

test('invalid inputs are rejected before any records are read', async () => {
  const db = client('ADMIN');
  assert.equal((await servePayrollHours(db, req({ month: '2026-13' }))).status, 400);
  assert.equal((await servePayrollHours(db, req({ month: '2026-12', worker_id: { $ne: '' } }))).status, 400);
  assert.equal((await servePayrollHours(db, req({ month: '2026-12', worker_id: 'not-an-object-id' }))).status, 400);
  assert.ok(db.reads.every((read) => read === 'InternalUser'));
});

test('cursor pages are followed before emitting totals', async () => {
  const db = client('ADMIN');
  const profile = '1234567890abcdef12345678';
  const shifts = [{ id: 'a', start: '06:00:00', end: '08:00:00' }, { id: 'b', start: '09:00:00', end: '12:00:00' }];
  db.asServiceRole.entities.AttendanceRecord.filter = async (_query, { cursor }) => {
    const { id, start, end } = shifts[cursor ? 1 : 0];
    return { items: [{ id, worker_profile_id: profile, status: 'CLOSED', effective_start_at: `2026-11-08T${start}.000Z`,
      effective_end_at: `2026-11-08T${end}.000Z` }], has_more: !cursor, next_cursor: cursor ? null : 'more' };
  };
  const result = await (await servePayrollHours(db, req({ month: '2026-11' }), new Date('2026-12-01T00:00:00Z'))).json();
  assert.equal(result.workers[0].hours.verified, 5 * 3600000);
  assert.equal(result.workers[0].days[0].rows.length, 2);
});