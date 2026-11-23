import test from "node:test";
import assert from "node:assert/strict";
import { buildComparison } from "./attendanceComparison.js";

// Israel is UTC+2 in November 2026. SIMULATED data only.
const NOW = Date.parse("2026-11-30T20:00:00Z");
const shift = (id, date, start, end, extra = {}) => ({ id, worker_id: "w1", worker_name: "עובד בדיקה", date, row_type: "OPERATIONS_MORNING", row_label: "תפעול", start_time: start, end_time: end, status: "PLANNED", ...extra });
const rec = (id, start, end, extra = {}) => ({ id, worker_profile_id: "w1", status: "CLOSED", effective_start_at: start, effective_end_at: end, ...extra });
const run = (shifts, records, requests = [], nowMs = NOW) => buildComparison({ shifts, records, requests, start: "2026-11-01", end: "2026-11-30", nowMs }).w1;

test("exact arrival and departure minutes, no tolerance", () => {
  const c = run([shift("a", "2026-11-10", "07:00", "15:00")], [rec("r", "2026-11-10T05:03:00Z", "2026-11-10T12:58:00Z")]);
  const s = c.shifts[0];
  assert.equal(s.state, "RECORDED");
  assert.equal(s.arrival_diff_minutes, 3);
  assert.equal(s.departure_diff_minutes, -2);
  assert.equal(s.verified_minutes, 475);
  assert.equal(c.planned_minutes, 480);
  assert.equal(c.extra.length, 0);
});

test("overlapping shifts: planned and actual minutes are counted once", () => {
  const c = run([shift("a", "2026-11-10", "07:00", "15:00"), shift("b", "2026-11-10", "13:00", "17:00")], [rec("r", "2026-11-10T05:00:00Z", "2026-11-10T15:00:00Z")]);
  assert.equal(c.planned_minutes, 600);
  assert.deepEqual(c.shifts.map((s) => s.verified_minutes), [480, 120]);
  assert.ok(c.shifts.every((s) => s.overlaps_other_shift));
});

test("back-to-back shifts with one session; split sessions; extra time before the shift", () => {
  const c = run(
    [shift("a", "2026-11-10", "07:00", "15:00"), shift("b", "2026-11-10", "15:00", "23:00"), shift("c", "2026-11-11", "08:00", "16:00")],
    [rec("r1", "2026-11-10T04:30:00Z", "2026-11-10T21:10:00Z"), rec("r2", "2026-11-11T06:00:00Z", "2026-11-11T09:00:00Z"), rec("r3", "2026-11-11T10:00:00Z", "2026-11-11T14:00:00Z")],
  );
  const [a, b, d] = c.shifts;
  assert.equal(a.arrival_diff_minutes, -30);
  assert.equal(a.departure_continuous, true);
  assert.equal(b.arrival_continuous, true);
  assert.equal(b.departure_diff_minutes, 10);
  assert.equal(d.sessions.length, 2);
  assert.equal(d.verified_minutes, 420);
  assert.equal(c.extra_verified_minutes, 40);
});

test("no clock record needs review; future shift does not; pending and auto-closed stay separate", () => {
  const c = run(
    [shift("a", "2026-11-10", "07:00", "15:00"), shift("b", "2026-11-12", "07:00", "15:00"), shift("f", "2026-11-30", "23:00", "07:00"), shift("n", "2026-11-10", "", "", { row_type: "NIGHT_ON_CALL" })],
    [rec("r", "2026-11-12T05:00:00Z", "2026-11-12T18:00:00Z", { status: "AUTO_CLOSED", needs_review: true })],
    [{ worker_profile_id: "w1", request_type: "EDIT", attendance_record_id: "r" }],
  );
  const by = Object.fromEntries(c.shifts.map((s) => [s.id, s]));
  assert.equal(by.a.state, "NO_RECORD");
  assert.equal(by.b.unverified_minutes, 480);
  assert.equal(by.b.verified_minutes, 0);
  assert.equal(by.b.departure_diff_minutes, null);
  assert.equal(by.b.pending_correction, true);
  assert.equal(by.f.state, "UPCOMING");
  assert.equal(by.n.state, "ON_CALL");
  assert.equal(c.review_count, 2);
  assert.equal(c.planned_shift_count, 3);
  assert.equal(c.on_call_count, 1);
});

test("month boundary: overnight shifts are clipped to the period", () => {
  const c = run([shift("p", "2026-10-31", "22:00", "06:00"), shift("l", "2026-11-30", "22:00", "06:00")], [rec("r", "2026-10-31T20:00:00Z", "2026-11-01T04:00:00Z")], [], Date.parse("2026-12-02T00:00:00Z"));
  assert.equal(c.planned_minutes, 360 + 120);
  assert.equal(c.shifts[0].starts_before_period, true);
  assert.equal(c.planned_shift_count, 1);
  assert.equal(c.extra.length, 0);
});