import test from "node:test";
import assert from "node:assert/strict";
import { attendanceAccess, parseTimesInput, presentRecord, AUTO_CLOSE_MS } from "./attendancePolicy.js";
import { clockIn, clockOut, closeExpiredSessions } from "./attendanceSession.js";
import { saveCorrection, voidRecord } from "./attendanceCorrection.js";
import { buildAttendanceTotals } from "./attendanceReport.js";
import { myStatus, myMonth, managerDay, attendanceReport, recordAudit } from "./attendanceRead.js";
import { withLeaseLock } from "./leaseLock.js";
import { makeDb, callerOf, W1, W2, rid, at, T0 } from "./attendanceTestDb.js";

const emp1 = callerOf("HOUSEKEEPING_STAFF", W1, "u1");
const emp2 = callerOf("OPERATIONS", W2, "u2");
const admin = callerOf("ADMIN", null, "uA");

test("access: active linked WorkerProfile required to clock; only ADMIN/SUPER_ADMIN manage", () => {
  assert.equal(attendanceAccess("HOUSEKEEPING_STAFF", W1).canClock, true);
  assert.equal(attendanceAccess("HOUSEKEEPING_STAFF", null).canView, false);
  assert.equal(attendanceAccess("OPERATIONS", { ...W1, is_active: false }).canView, false);
  assert.equal(attendanceAccess("MECHINA_USER", W1).canView, false);
  assert.equal(attendanceAccess("OPERATIONS", W1).isManager, false);
  assert.equal(attendanceAccess("ADMIN", null).isManager, true);
  assert.equal(attendanceAccess("SUPER_ADMIN", W1).canClock, true);
});

test("1+2. clock-in records the server-resolved worker; clock-out computes elapsed time", async () => {
  const db = makeDb();
  const a = await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  const row = db.AttendanceRecord.rows[0];
  assert.equal(row.worker_profile_id, "worker1");
  assert.equal(row.internal_user_id, "u1");
  assert.equal(row.clock_in_at, T0);
  assert.equal(row.auto_close_due_at, "2026-11-23T19:00:00.000Z");
  assert.equal(a.record.display_status, "ACTIVE");
  const b = await clockOut(db, emp1, { now: at("2026-11-23T14:30:00.000Z") });
  assert.equal(b.record.worked_minutes, 510);
  assert.equal(row.status, "CLOSED");
  assert.equal(row.clock_out_at, "2026-11-23T14:30:00.000Z");
  assert.equal(row.closed_by, "EMPLOYEE");
});

test("3. refresh/new device: status reads the server session and elapsed time from its start", async () => {
  const db = makeDb();
  await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  const s = await myStatus(db, emp1, at("2026-11-23T07:15:00.000Z"));
  assert.equal(s.active.start_at, T0);
  assert.equal(s.active.worked_minutes, 75);
});

test("4. simultaneous clock-in requests create exactly one session; request replay is idempotent", async () => {
  const db = makeDb();
  const lockOpts = { attempts: 40, delayMs: 2 };
  const results = await Promise.all(Array.from({ length: 6 }, () => withLeaseLock(db, "AttendanceLock", "WORKER|worker1", () => clockIn(db, emp1, { requestId: rid(), now: at(T0) }), lockOpts)));
  assert.ok(results.every((r) => r.value));
  assert.equal(db.AttendanceRecord.rows.length, 1);
  assert.equal(results.filter((r) => r.value.created).length, 1);
  const key = db.AttendanceRecord.rows[0].clock_in_request_id;
  assert.equal((await clockIn(db, emp1, { requestId: key, now: at(T0) })).replay, true);
  assert.equal((await clockIn(db, emp2, { requestId: key, now: at(T0) })).status, 409);
});

test("5. two separate sessions on the same day", async () => {
  const db = makeDb();
  await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  await clockOut(db, emp1, { now: at("2026-11-23T10:00:00.000Z") });
  await clockIn(db, emp1, { requestId: rid(), now: at("2026-11-23T15:00:00.000Z") });
  await clockOut(db, emp1, { now: at("2026-11-23T18:00:00.000Z") });
  const t = buildAttendanceTotals(db.AttendanceRecord.rows, "2026-11-23", "2026-11-23", Date.parse("2026-11-24T00:00:00Z"));
  assert.equal(t.workers[0].session_count, 2);
  assert.equal(t.workers[0].verified_minutes, 420);
});

test("6+7+8. automatic closure at 13h without the employee; idempotent; unverified time kept separate", async () => {
  const db = makeDb();
  await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  assert.deepEqual(await closeExpiredSessions(db, at("2026-11-23T18:59:59.000Z")), { checked: 0, closed: 0 });
  const r1 = await closeExpiredSessions(db, at("2026-11-23T19:03:00.000Z"));
  assert.deepEqual(r1, { checked: 1, closed: 1 });
  const row = db.AttendanceRecord.rows[0];
  assert.equal(row.status, "AUTO_CLOSED");
  assert.equal(row.effective_end_at, "2026-11-23T19:00:00.000Z"); // 21:00 Israel = start + 13h
  assert.equal(row.needs_review, true);
  assert.equal(row.closed_by, "SYSTEM");
  assert.equal(row.clock_out_at, undefined);
  assert.deepEqual(await closeExpiredSessions(db, at("2026-11-23T19:10:00.000Z")), { checked: 0, closed: 0 });
  assert.equal(presentRecord(row, Date.now()).display_status, "NEEDS_REVIEW");
  const t = buildAttendanceTotals(db.AttendanceRecord.rows, "2026-11-23", "2026-11-23", Date.now());
  assert.equal(t.workers[0].verified_minutes, 0);
  assert.equal(t.workers[0].unverified_minutes, 780);
  assert.equal(t.workers[0].auto_closed_count, 1);
  // Recovery after missed runs: a session days old is still closed at start + 13h.
  await clockIn(db, emp2, { requestId: rid(), now: at("2026-11-20T06:00:00.000Z") });
  await closeExpiredSessions(db, at("2026-11-23T20:00:00.000Z"));
  assert.equal(db.AttendanceRecord.rows[1].effective_end_at, "2026-11-20T19:00:00.000Z");
});

test("6b. clock-out after 13h and clock-out racing the scheduler close once, as automatic", async () => {
  const db = makeDb();
  await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  const late = at("2026-11-23T20:00:00.000Z");
  const [out, job] = await Promise.all([clockOut(db, emp1, { now: late }), closeExpiredSessions(db, late)]);
  const row = db.AttendanceRecord.rows[0];
  assert.equal(row.status, "AUTO_CLOSED");
  assert.equal(row.effective_end_at, "2026-11-23T19:00:00.000Z");
  assert.equal(out.auto_closed, true);
  assert.ok(job.closed + (out.already ? 0 : 1) === 1);
  // Status view never shows a running session past 13h, even before the scheduler runs.
  const db2 = makeDb();
  await clockIn(db2, emp1, { requestId: rid(), now: at(T0) });
  const s = await myStatus(db2, emp1, late);
  assert.equal(s.active, null);
  assert.equal(s.today_records[0].display_status, "NEEDS_REVIEW");
});

test("9+11. manager direct correction without a note; originals and actor preserved", async () => {
  const db = makeDb();
  await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  await closeExpiredSessions(db, at("2026-11-23T19:05:00.000Z"));
  const rec = db.AttendanceRecord.rows[0];
  const res = await saveCorrection(db, admin, { recordId: rec.id, input: { date: "2026-11-23", start_time: "08:00", end_time: "16:30" }, requestId: rid(), now: at("2026-11-24T08:00:00Z") });
  assert.equal(res.record.display_status, "CORRECTED");
  assert.equal(res.record.worked_minutes, 510);
  assert.equal(rec.clock_in_at, T0); // original clock-in untouched
  assert.equal(rec.status, "CLOSED");
  assert.equal(rec.was_auto_closed, true);
  const c = db.AttendanceCorrection.rows[0];
  assert.equal(c.change_type, "RESOLVE_AUTO_CLOSE");
  assert.equal(c.original_end_at, "2026-11-23T19:00:00.000Z");
  assert.equal(c.original_status, "AUTO_CLOSED");
  assert.equal(c.corrected_end_at, "2026-11-23T14:30:00.000Z");
  assert.equal(c.corrected_by_internal_user_id, "uA");
  assert.equal(c.corrected_by_worker_id, null);
  assert.equal(c.by_manager, true);
  assert.equal(c.state, "APPLIED");
  assert.equal(c.note, "");
  // Forgotten session added manually, again without a note
  const add = await saveCorrection(db, admin, { worker: W1, input: { date: "2026-11-22", start_time: "09:00", end_time: "13:00" }, requestId: rid(), now: at("2026-11-24T08:00:00Z") });
  assert.equal(add.record.source, "MANUAL");
  assert.equal(add.record.worked_minutes, 240);
  assert.equal(db.AttendanceCorrection.rows[1].change_type, "CREATE_MANUAL");
  // Start of a running session can be corrected; its 13h cutoff follows the corrected start
  await clockIn(db, emp1, { requestId: rid(), now: at("2026-11-24T06:30:00Z") });
  const act = db.AttendanceRecord.rows.find((r) => r.status === "ACTIVE");
  await saveCorrection(db, admin, { recordId: act.id, input: { date: "2026-11-24", start_time: "08:00" }, requestId: rid(), now: at("2026-11-24T07:00:00Z") });
  assert.equal(act.effective_start_at, "2026-11-24T06:00:00.000Z");
  assert.equal(act.auto_close_due_at, "2026-11-24T19:00:00.000Z");
  assert.equal(act.clock_in_at, "2026-11-24T06:30:00.000Z");
});

test("10+12. employees cannot touch another worker's attendance; managers can, flagged as manager", async () => {
  const db = makeDb();
  await clockIn(db, emp2, { requestId: rid(), now: at(T0) });
  await clockOut(db, emp2, { now: at("2026-11-23T14:00:00Z") });
  const rec = db.AttendanceRecord.rows[0];
  const input = { date: "2026-11-23", start_time: "07:00", end_time: "15:00" };
  assert.equal((await saveCorrection(db, emp1, { recordId: rec.id, input, requestId: rid(), now: at("2026-11-24T08:00:00Z") })).status, 403);
  assert.equal((await saveCorrection(db, emp1, { worker: W2, input, requestId: rid(), now: at("2026-11-24T08:00:00Z") })).status, 403);
  assert.equal((await voidRecord(db, emp1, { recordId: rec.id, requestId: rid(), now: at("2026-11-24T08:00:00Z") })).status, 403);
  assert.equal(db.AttendanceCorrection.rows.length, 0);
  assert.equal((await recordAudit(db, emp1, rec.id)).status, 403);
  const m = await saveCorrection(db, admin, { recordId: rec.id, input: { ...input, note: "לפי דיווח" }, requestId: rid(), now: at("2026-11-24T08:00:00Z") });
  assert.equal(m.record.worked_minutes, 480);
  assert.equal(db.AttendanceCorrection.rows[0].by_manager, true);
  const audit = await recordAudit(db, admin, rec.id);
  assert.equal(audit.corrections.length, 1);
  assert.equal(audit.original.clock_in_at, T0);
  assert.equal(audit.original.clock_out_at, "2026-11-23T14:00:00.000Z");
  assert.equal((await managerDay(db, emp1, {})).status, 403);
  assert.equal((await attendanceReport(db, emp2, { period: "week", start: "2026-11-22" })).status, 403);
});

test("impossible durations, future times, overlaps and duplicates are rejected", async () => {
  const db = makeDb();
  const now = at("2026-11-23T12:00:00Z");
  await saveCorrection(db, admin, { worker: W1, input: { date: "2026-11-22", start_time: "08:00", end_time: "16:00" }, requestId: rid(), now });
  const try_ = (input) => saveCorrection(db, admin, { worker: W1, input, requestId: rid(), now });
  assert.equal((await try_({ date: "2026-11-22", start_time: "10:00", end_time: "12:00" })).status, 409); // overlap
  assert.equal((await try_({ date: "2026-11-22", start_time: "08:00", end_time: "16:00" })).status, 409); // duplicate
  assert.equal((await try_({ date: "2026-11-24", start_time: "08:00", end_time: "09:00" })).status, 400); // future
  assert.equal((await try_({ date: "2026-11-22", start_time: "08:00", end_time: "08:00" })).status, 409); // 24h wraps onto itself → overlap
  assert.equal((await try_({ date: "2026-11-22", start_time: "", end_time: "10:00" })).status, 400);
  assert.equal((await try_({ date: "2026-11-21", start_time: "16:00", end_time: "07:59" })).status, undefined); // overnight OK
  assert.equal(db.AttendanceRecord.rows.length, 2);
  const keyed = rid();
  await saveCorrection(db, admin, { worker: W1, input: { date: "2026-11-20", start_time: "08:00", end_time: "09:00" }, requestId: keyed, now });
  await saveCorrection(db, admin, { worker: W1, input: { date: "2026-11-20", start_time: "08:00", end_time: "09:00" }, requestId: keyed, now });
  assert.equal(db.AttendanceRecord.rows.length, 3); // same request twice → one record
  // Clock-in cannot overlap a running session
  await clockIn(db, emp1, { requestId: rid(), now: at("2026-11-23T06:00:00Z") });
  assert.equal((await try_({ date: "2026-11-23", start_time: "09:00", end_time: "10:00" })).status, 409);
});

test("13. overnight sessions split by Israel calendar day", () => {
  const p = parseTimesInput({ date: "2026-11-23", start_time: "22:00", end_time: "06:00" }, { requireEnd: true }).data;
  assert.equal(p.start_at, "2026-11-23T20:00:00.000Z");
  assert.equal(p.end_at, "2026-11-24T04:00:00.000Z");
  const rec = { id: "x", worker_profile_id: "w", status: "CLOSED", effective_start_at: p.start_at, effective_end_at: p.end_at };
  const t = buildAttendanceTotals([rec], "2026-11-23", "2026-11-24", Date.now()).workers[0];
  assert.equal(t.verified_minutes, 480);
  assert.deepEqual(t.days.map((d) => [d.date, d.verified_minutes]), [["2026-11-23", 120], ["2026-11-24", 360]]);
});

test("14. DST transitions use real elapsed minutes", () => {
  const spring = parseTimesInput({ date: "2026-03-27", start_time: "01:00", end_time: "04:00" }, { requireEnd: true }).data; // clocks jump 02:00→03:00
  assert.equal((Date.parse(spring.end_at) - Date.parse(spring.start_at)) / 60000, 120);
  const autumn = parseTimesInput({ date: "2026-10-25", start_time: "00:00", end_time: "03:00" }, { requireEnd: true }).data; // clocks fall back 02:00→01:00
  assert.equal((Date.parse(autumn.end_at) - Date.parse(autumn.start_at)) / 60000, 240);
  assert.equal(new Date(Date.parse("2026-07-05T05:00:00Z") + AUTO_CLOSE_MS).toISOString(), "2026-07-05T18:00:00.000Z"); // summer 08:00 → 21:00
});

test("15. weekly/monthly totals: month boundary split, overlapping data counted once", () => {
  const recs = [
    { id: "a", worker_profile_id: "w", status: "CLOSED", effective_start_at: "2026-10-31T20:00:00.000Z", effective_end_at: "2026-11-01T02:00:00.000Z" }, // Oct 31 22:00 → Nov 1 04:00
    { id: "b", worker_profile_id: "w", status: "CLOSED", effective_start_at: "2026-11-01T01:00:00.000Z", effective_end_at: "2026-11-01T03:00:00.000Z" }, // overlaps a by 60 min
    { id: "v", worker_profile_id: "w", status: "VOIDED", effective_start_at: "2026-11-02T06:00:00.000Z", effective_end_at: "2026-11-02T14:00:00.000Z" },
  ];
  assert.equal(buildAttendanceTotals(recs, "2026-10-01", "2026-10-31", Date.now()).workers[0].verified_minutes, 120);
  assert.equal(buildAttendanceTotals(recs, "2026-11-01", "2026-11-30", Date.now()).workers[0].verified_minutes, 300);
  assert.equal(buildAttendanceTotals(recs, "2026-10-25", "2026-11-07", Date.now()).workers[0].verified_minutes, 420);
});

test("16. attendance never writes WorkShift/WorkSchedule (planned shifts shown as context only)", async () => {
  const db = makeDb({
    schedules: [{ id: "s1", status: "PUBLISHED", week_start_date: "2026-11-22" }],
    shifts: [{ id: "sh1", work_schedule_id: "s1", date: "2026-11-23", status: "PLANNED", worker_id: "worker1", row_type: "HOUSEKEEPING_MORNING", row_label: "משק בית בוקר", start_time: "08:00", end_time: "15:00" },
      { id: "sh2", work_schedule_id: "s1", date: "2026-11-23", status: "PLANNED", worker_id: "worker2", row_type: "OPERATIONS_MORNING", row_label: "תפעול בוקר", start_time: "07:00", end_time: "15:00" }],
  });
  const before = JSON.stringify([db.WorkShift.rows, db.WorkSchedule.rows]);
  await clockIn(db, emp1, { requestId: rid(), now: at(T0) });
  const s = await myStatus(db, emp1, at("2026-11-23T07:00:00Z"));
  assert.deepEqual(s.planned_today.map((x) => x.row_label), ["משק בית בוקר"]);
  const day = await managerDay(db, admin, { date: "2026-11-23" }, at("2026-11-23T07:00:00Z"));
  assert.deepEqual(day.missing.map((m) => m.worker_id), ["worker2"]);
  assert.equal(day.sections.active.length, 1);
  await clockOut(db, emp1, { now: at("2026-11-23T13:00:00Z") });
  await attendanceReport(db, admin, { period: "month", start: "2026-11-01" }, at("2026-11-23T13:00:00Z"));
  assert.equal(JSON.stringify([db.WorkShift.rows, db.WorkSchedule.rows]), before);
});

test("void keeps the record and audit; pending correction resumes on retry", async () => {
  const db = makeDb();
  await saveCorrection(db, admin, { worker: W1, input: { date: "2026-11-22", start_time: "08:00", end_time: "10:00" }, requestId: rid(), now: at("2026-11-23T08:00:00Z") });
  const rec = db.AttendanceRecord.rows[0];
  const v = await voidRecord(db, admin, { recordId: rec.id, requestId: rid(), now: at("2026-11-23T08:00:00Z") });
  assert.equal(v.record.display_status, "VOIDED");
  assert.equal(db.AttendanceRecord.rows.length, 1);
  assert.equal(db.AttendanceCorrection.rows.at(-1).original_status, "CLOSED");
  const m = await myMonth(db, emp1, "2026-11", at("2026-11-23T08:00:00Z"));
  assert.equal(m.records.length, 1);
  assert.equal(m.totals, null); // voided time is never counted
  // Simulated crash between audit write and record update → retry with same request id applies it once
  const db2 = makeDb();
  await clockIn(db2, emp1, { requestId: rid(), now: at(T0) });
  await clockOut(db2, emp1, { now: at("2026-11-23T14:00:00Z") });
  const r2 = db2.AttendanceRecord.rows[0];
  const key = rid();
  db2.AttendanceCorrection.rows.push({ id: "pend", attendance_record_id: r2.id, worker_profile_id: "worker1", request_id: key, state: "PENDING", change_type: "EDIT_END",
    original_start_at: r2.effective_start_at, original_end_at: r2.effective_end_at, original_status: "CLOSED",
    corrected_start_at: r2.effective_start_at, corrected_end_at: "2026-11-23T15:00:00.000Z", corrected_status: "CLOSED", corrected_by_internal_user_id: "uA", corrected_by_name: "מנהל", corrected_at: "2026-11-23T16:00:00Z", created_date: "0" });
  const res = await saveCorrection(db2, admin, { recordId: r2.id, input: {}, requestId: key, now: at("2026-11-23T16:00:00Z") });
  assert.equal(res.replay, true);
  assert.equal(r2.effective_end_at, "2026-11-23T15:00:00.000Z");
  assert.equal(db2.AttendanceCorrection.rows[0].state, "APPLIED");
  assert.equal(r2.correction_count, 1);
});