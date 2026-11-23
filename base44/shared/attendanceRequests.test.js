import test from "node:test";
import assert from "node:assert/strict";
import { clockIn, clockOut, closeExpiredSessions } from "./attendanceSession.js";
import { saveCorrection } from "./attendanceCorrection.js";
import { submitRequest, cancelRequest, approveRequest, rejectRequest, managerRequests } from "./attendanceRequests.js";
import { myMonth, myStatus, attendanceReport, recordAudit } from "./attendanceRead.js";
import { withLeaseLock } from "./leaseLock.js";
import { makeDb, callerOf, W1, W2, rid, at, T0 } from "./attendanceTestDb.js";

const emp1 = callerOf("HOUSEKEEPING_STAFF", W1, "u1");
const emp2 = callerOf("OPERATIONS", W2, "u2");
const admin = callerOf("ADMIN", null, "uA");
const admin2 = callerOf("SUPER_ADMIN", null, "uB");
const NOW = at("2026-11-24T08:00:00Z");
const snap = (r) => JSON.stringify({ s: r.status, a: r.effective_start_at, b: r.effective_end_at, m: r.worked_minutes, c: r.correction_count });

async function closedDay(db, caller = emp1) {
  await clockIn(db, caller, { requestId: rid(), now: at(T0) });
  await clockOut(db, caller, { now: at("2026-11-23T14:00:00Z") }); // 08:00–16:00 = 480
  return db.AttendanceRecord.rows.at(-1);
}
const edit = (db, rec, times, caller = emp1) => submitRequest(db, caller, { type: "EDIT", recordId: rec.id, input: { date: "2026-11-23", ...times }, requestKey: rid(), now: NOW });

test("1. employee correction request leaves the record and official hours unchanged", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const before = snap(rec);
  const out = await edit(db, rec, { start_time: "08:00", end_time: "17:00" });
  assert.equal(out.pending, true);
  assert.equal(out.request.status, "PENDING");
  assert.equal(out.request.original_minutes, 480);
  assert.equal(out.request.requested_minutes, 540);
  assert.equal(snap(rec), before);
  assert.equal(db.AttendanceCorrection.rows.length, 0);
  const m = await myMonth(db, emp1, "2026-11", NOW);
  assert.equal(m.totals.verified_minutes, 480);
  assert.equal(m.records[0].pending_request.status, "PENDING");
  // No duplicate pending request for the same record; cancel then resubmit is allowed.
  assert.equal((await edit(db, rec, { start_time: "07:00", end_time: "16:00" })).status, 409);
  assert.equal((await cancelRequest(db, emp1, { id: out.request.id })).request.status, "CANCELLED");
  assert.equal((await edit(db, rec, { start_time: "07:00", end_time: "16:00" })).request.status, "PENDING");
  // Direct employee corrections are refused server-side.
  assert.equal((await saveCorrection(db, emp1, { recordId: rec.id, input: { date: "2026-11-23", start_time: "07:00", end_time: "18:00" }, requestId: rid(), now: NOW })).status, 403);
  assert.equal(snap(rec), before);
});

test("2. admin approval applies the change exactly once with full audit", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const { request } = await edit(db, rec, { start_time: "08:00", end_time: "17:00" });
  const key = rid();
  const a = await approveRequest(db, admin, { id: request.id, decisionKey: key, now: NOW });
  assert.equal(a.request.status, "APPROVED");
  assert.equal(a.request.decided_by_name, "מנהל");
  assert.equal(rec.worked_minutes, 540);
  assert.equal(rec.correction_count, 1);
  assert.equal(rec.clock_out_at, "2026-11-23T14:00:00.000Z"); // original clock-out preserved
  const again = await approveRequest(db, admin, { id: request.id, decisionKey: key, now: NOW });
  assert.equal(again.replay, true);
  assert.equal((await approveRequest(db, admin2, { id: request.id, decisionKey: rid(), now: NOW })).status, 409);
  assert.equal(rec.correction_count, 1);
  assert.equal(db.AttendanceCorrection.rows.length, 1);
  const c = db.AttendanceCorrection.rows[0];
  assert.equal(c.source_request_id, request.id);
  assert.equal(c.requested_by_name, "עובד בדיקה א");
  assert.equal(c.corrected_by_internal_user_id, "uA");
  assert.equal(c.original_end_at, "2026-11-23T14:00:00.000Z");
  const audit = await recordAudit(db, emp1, rec.id);
  assert.equal(audit.corrections[0].from_request, true);
  assert.equal(audit.requests[0].status, "APPROVED");
  const rep = await attendanceReport(db, admin, { period: "month", start: "2026-11-01" }, NOW);
  assert.equal(rep.workers[0].verified_minutes, 540);
});

test("3. rejection keeps the original hours; employee sees the result", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const before = snap(rec);
  const { request } = await edit(db, rec, { start_time: "06:00", end_time: "16:00" });
  const r = await rejectRequest(db, admin, { id: request.id, decisionKey: rid(), now: NOW });
  assert.equal(r.request.status, "REJECTED");
  assert.equal(r.request.decision_note, ""); // explanation optional
  assert.equal(snap(rec), before);
  assert.equal(db.AttendanceCorrection.rows.length, 0);
  assert.equal((await approveRequest(db, admin, { id: request.id, decisionKey: rid(), now: NOW })).status, 409);
  assert.equal(snap(rec), before);
});

test("4. forgotten hours create no official record until approval", async () => {
  const db = makeDb();
  const out = await submitRequest(db, emp1, { type: "ADD", input: { date: "2026-11-22", start_time: "09:00", end_time: "13:00" }, requestKey: rid(), now: NOW });
  assert.equal(out.request.request_type, "ADD");
  assert.equal(db.AttendanceRecord.rows.length, 0);
  assert.equal((await myMonth(db, emp1, "2026-11", NOW)).totals, null);
  // Duplicate overlapping ADD request is refused while the first is pending.
  assert.equal((await submitRequest(db, emp1, { type: "ADD", input: { date: "2026-11-22", start_time: "10:00", end_time: "12:00" }, requestKey: rid(), now: NOW })).status, 409);
  const a = await approveRequest(db, admin, { id: out.request.id, decisionKey: rid(), now: NOW });
  assert.equal(a.record.source, "MANUAL");
  assert.equal(db.AttendanceRecord.rows.length, 1);
  assert.equal((await myMonth(db, emp1, "2026-11", NOW)).totals.verified_minutes, 240);
});

test("5. cancellation request keeps the record until approved", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const { request } = await submitRequest(db, emp1, { type: "VOID", recordId: rec.id, input: {}, requestKey: rid(), now: NOW });
  assert.equal(rec.status, "CLOSED");
  assert.equal((await myMonth(db, emp1, "2026-11", NOW)).totals.verified_minutes, 480);
  await approveRequest(db, admin, { id: request.id, decisionKey: rid(), now: NOW });
  assert.equal(rec.status, "VOIDED");
  assert.equal(db.AttendanceRecord.rows.length, 1); // nothing deleted
  assert.equal((await myMonth(db, emp1, "2026-11", NOW)).totals, null);
});

test("6. concurrent manager decisions produce exactly one final decision", async () => {
  for (const withLock of [true, false]) {
    const db = makeDb();
    const rec = await closedDay(db);
    const { request } = await edit(db, rec, { start_time: "08:00", end_time: "17:00" });
    const run = (fn) => (withLock ? withLeaseLock(db, "AttendanceLock", "WORKER|worker1", fn, { attempts: 40, delayMs: 2 }).then((x) => x.value) : fn());
    const results = await Promise.all([
      run(() => approveRequest(db, admin, { id: request.id, decisionKey: rid(), now: NOW })),
      run(() => approveRequest(db, admin2, { id: request.id, decisionKey: rid(), now: NOW })),
      run(() => rejectRequest(db, admin2, { id: request.id, decisionKey: rid(), now: NOW })),
    ]);
    assert.equal(results.filter((r) => !r.error).length, 1);
    const final = db.AttendanceCorrectionRequest.rows[0].status;
    assert.ok(["APPROVED", "REJECTED"].includes(final));
    assert.equal(rec.correction_count || 0, final === "APPROVED" ? 1 : 0);
    assert.equal(db.AttendanceCorrection.rows.length, final === "APPROVED" ? 1 : 0);
  }
});

test("7. pending requests and auto-closed sessions never count as verified hours", async () => {
  const db = makeDb();
  await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  await closeExpiredSessions(db, at("2026-11-23T19:05:00Z"));
  const rec = db.AttendanceRecord.rows[0];
  const { request } = await edit(db, rec, { start_time: "08:00", end_time: "16:30" });
  await submitRequest(db, emp1, { type: "ADD", input: { date: "2026-11-21", start_time: "08:00", end_time: "12:00" }, requestKey: rid(), now: NOW });
  let t = (await myMonth(db, emp1, "2026-11", NOW)).totals;
  assert.equal(t.verified_minutes, 0);
  assert.equal(t.unverified_minutes, 780);
  assert.equal(rec.status, "AUTO_CLOSED");
  assert.equal(rec.needs_review, true);
  await approveRequest(db, admin, { id: request.id, decisionKey: rid(), now: NOW });
  t = (await myMonth(db, emp1, "2026-11", NOW)).totals;
  assert.equal(t.verified_minutes, 510);
  assert.equal(t.unverified_minutes, 0);
  assert.equal(db.AttendanceCorrection.rows[0].change_type, "RESOLVE_AUTO_CLOSE");
});

test("outdated or overlapping requests cannot be approved; failed approval returns to pending", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const { request } = await edit(db, rec, { start_time: "08:00", end_time: "17:00" });
  await saveCorrection(db, admin, { recordId: rec.id, input: { date: "2026-11-23", start_time: "08:00", end_time: "15:00" }, requestId: rid(), now: NOW });
  const list = await managerRequests(db, admin);
  assert.equal(list.pending[0].outdated, true);
  assert.equal((await approveRequest(db, admin, { id: request.id, decisionKey: rid(), now: NOW })).status, 409);
  assert.equal(rec.worked_minutes, 420); // manager's direct correction stands
  assert.equal(db.AttendanceCorrectionRequest.rows[0].status, "PENDING");
  // ADD that overlaps a session recorded after submission is blocked at approval.
  const add = await submitRequest(db, emp1, { type: "ADD", input: { date: "2026-11-22", start_time: "09:00", end_time: "13:00" }, requestKey: rid(), now: NOW });
  await saveCorrection(db, admin, { worker: W1, input: { date: "2026-11-22", start_time: "12:00", end_time: "14:00" }, requestId: rid(), now: NOW });
  assert.equal((await approveRequest(db, admin, { id: add.request.id, decisionKey: rid(), now: NOW })).status, 409);
  assert.equal(db.AttendanceRecord.rows.length, 2);
});

test("security: only ADMIN/SUPER_ADMIN decide; employees touch only their own requests", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const { request } = await edit(db, rec, { start_time: "08:00", end_time: "17:00" });
  assert.equal((await approveRequest(db, emp1, { id: request.id, decisionKey: rid(), now: NOW })).status, 403);
  assert.equal((await rejectRequest(db, emp2, { id: request.id, decisionKey: rid(), now: NOW })).status, 403);
  assert.equal((await cancelRequest(db, emp2, { id: request.id })).status, 403);
  assert.equal((await edit(db, rec, { start_time: "08:00", end_time: "12:00" }, emp2)).status, 403);
  assert.equal((await managerRequests(db, emp1)).status, 403);
  // A manager who somehow submitted a request cannot decide it.
  const selfReq = { ...db.AttendanceCorrectionRequest.rows[0], id: "self", requested_by_internal_user_id: "uA", status: "PENDING" };
  db.AttendanceCorrectionRequest.rows.push(selfReq);
  assert.equal((await approveRequest(db, admin, { id: "self", decisionKey: rid(), now: NOW })).status, 403);
  assert.equal(rec.correction_count, 0);
});

test("8+9. manager direct corrections still apply and audit; 13h cutoff and status unaffected", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const m = await saveCorrection(db, admin, { recordId: rec.id, input: { date: "2026-11-23", start_time: "07:00", end_time: "15:00" }, requestId: rid(), now: NOW });
  assert.equal(m.record.worked_minutes, 480);
  assert.equal(db.AttendanceCorrection.rows[0].by_manager, true);
  assert.equal(db.AttendanceCorrection.rows[0].source_request_id, undefined);
  assert.equal(db.AttendanceCorrectionRequest.rows.length, 0);
  const db2 = makeDb();
  await clockIn(db2, emp1, { requestId: rid(), now: at(T0) });
  assert.deepEqual(await closeExpiredSessions(db2, at("2026-11-23T19:03:00Z")), { checked: 1, closed: 1 });
  assert.equal(db2.AttendanceRecord.rows[0].effective_end_at, "2026-11-23T19:00:00.000Z");
  const s = await myStatus(db2, admin, NOW);
  assert.equal(s.pending_requests, 0);
});

test("crash after claim: approval resumes and applies once", async () => {
  const db = makeDb();
  const rec = await closedDay(db);
  const { request } = await edit(db, rec, { start_time: "08:00", end_time: "17:00" });
  const key = rid();
  Object.assign(db.AttendanceCorrectionRequest.rows[0], { status: "APPROVING", decision_key: key, decided_by_internal_user_id: "uA", decided_by_name: "מנהל" });
  const a = await approveRequest(db, admin2, { id: request.id, decisionKey: rid(), now: NOW });
  assert.equal(a.request.status, "APPROVED");
  assert.equal(a.request.decided_by_name, "מנהל");
  assert.equal(rec.worked_minutes, 540);
  assert.equal(rec.correction_count, 1);
});