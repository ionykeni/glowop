import test from "node:test";
import assert from "node:assert/strict";
import { israelDate, weekPeriod, monthPeriod, periodsBetween, daysBetween } from "./preventiveMaintenanceDates.js";
import { pmAccess, canCompleteTask, occurrenceState, intervalState, sortUnits, validateTaskInput } from "./preventiveMaintenancePolicy.js";
import { plannedPeriods, occurrenceKey } from "./preventiveMaintenanceGenerate.js";
import { completeOccurrence, completeUnit, voidEvent } from "./preventiveMaintenanceCompletion.js";

const OMRI = "6a5603940bb18427ed7ef90c";

test("Israel-local date and Sunday-Saturday week boundaries", () => {
  // 2026-11-14 22:30Z = Sunday 00:30 in Israel (UTC+2)
  assert.equal(israelDate(new Date("2026-11-14T22:30:00Z")), "2026-11-15");
  assert.equal(israelDate(new Date("2026-11-14T21:59:00Z")), "2026-11-14");
  assert.deepEqual(weekPeriod("2026-11-15"), { start: "2026-11-15", end: "2026-11-21" }); // Sunday
  assert.deepEqual(weekPeriod("2026-11-21"), { start: "2026-11-15", end: "2026-11-21" }); // Saturday
  assert.deepEqual(weekPeriod("2026-11-16"), { start: "2026-11-15", end: "2026-11-21" });
  assert.deepEqual(weekPeriod("2027-01-02"), { start: "2026-12-27", end: "2027-01-02" }); // across year
  // Summer time (UTC+3)
  assert.equal(israelDate(new Date("2026-07-04T21:30:00Z")), "2026-07-05");
});

test("month periods incl. February and 31-day months", () => {
  assert.deepEqual(monthPeriod("2026-11-16"), { start: "2026-11-01", end: "2026-11-30" });
  assert.deepEqual(monthPeriod("2027-02-10"), { start: "2027-02-01", end: "2027-02-28" });
  assert.deepEqual(monthPeriod("2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(monthPeriod("2026-12-31"), { start: "2026-12-01", end: "2026-12-31" });
});

test("generation starts at activation: no periods before tracking_start_date, bounded catch-up", () => {
  const weekly = { id: "t1", recurrence_type: "WEEKLY", is_active: true, tracking_start_date: "2026-11-16" };
  assert.deepEqual(plannedPeriods(weekly, "2026-11-16").map((p) => p.start), ["2026-11-15"]);
  assert.deepEqual(plannedPeriods(weekly, "2026-11-29").map((p) => p.start), ["2026-11-15", "2026-11-22", "2026-11-29"]);
  assert.equal(plannedPeriods(weekly, "2027-06-01").length, 8);
  assert.deepEqual(plannedPeriods({ ...weekly, tracking_start_date: "2026-12-01" }, "2026-11-16"), []);
  assert.deepEqual(plannedPeriods({ ...weekly, is_active: false }, "2026-11-16"), []);
  assert.deepEqual(plannedPeriods({ ...weekly, recurrence_type: "EVERY_N_DAYS" }, "2026-11-16"), []);
  const monthly = { id: "t2", recurrence_type: "MONTHLY", is_active: true, tracking_start_date: "2026-11-16" };
  assert.deepEqual(plannedPeriods(monthly, "2027-01-03").map((p) => p.start), ["2026-11-01", "2026-12-01", "2027-01-01"]);
  assert.equal(occurrenceKey("t1", "2026-11-15"), "t1|2026-11-15");
  assert.equal(periodsBetween("WEEKLY", "2026-11-23", "2026-11-16").length, 0);
  assert.equal(periodsBetween("WEEKLY", "2026-11-20", "2026-11-16").length, 1); // same week
});

test("access matrix: OPERATIONS/ADMIN/SUPER_ADMIN, verified Omri only, not all MAINTENANCE", () => {
  const omriProfile = { id: OMRI, is_active: true };
  assert.equal(pmAccess("OPERATIONS", null).canView, true);
  assert.equal(pmAccess("ADMIN", null).isManager, true);
  assert.equal(pmAccess("SUPER_ADMIN", null).isManager, true);
  assert.equal(pmAccess("OPERATIONS", null).isManager, false);
  assert.equal(pmAccess("MAINTENANCE", omriProfile).canView, true);
  assert.equal(pmAccess("MAINTENANCE", { id: "other-worker", is_active: true }).canView, false);
  assert.equal(pmAccess("MAINTENANCE", null).canView, false);
  assert.equal(pmAccess("MAINTENANCE", { id: OMRI, is_active: false }).canView, false);
  for (const r of ["VIEWER", "KITCHEN", "HOUSEKEEPING_STAFF", "HOUSEKEEPING_MANAGER", "QUOTES_MANAGER", "MECHINA_USER", null]) {
    assert.equal(pmAccess(r, null).canView, false, String(r));
  }
});

test("completion rights: team tasks vs Omri's assigned tasks", () => {
  const teamTask = { responsibility_type: "OPERATIONS_TEAM", is_active: true };
  const omriTask = { responsibility_type: "WORKER", responsible_worker_id: OMRI, is_active: true };
  const ops = pmAccess("OPERATIONS", null), admin = pmAccess("ADMIN", null), omri = pmAccess("MAINTENANCE", { id: OMRI, is_active: true });
  assert.equal(canCompleteTask(ops, teamTask), true);
  assert.equal(canCompleteTask(ops, omriTask), false);
  assert.equal(canCompleteTask(admin, omriTask), true);
  assert.equal(canCompleteTask(omri, omriTask), true);
  assert.equal(canCompleteTask(omri, teamTask), false);
  assert.equal(canCompleteTask(ops, { ...teamTask, is_active: false }), false);
});

test("overdue is derived; monthly becomes overdue only after the month ends", () => {
  const m = { status: "PENDING", period_start: "2026-11-01", period_end: "2026-11-30" };
  assert.equal(occurrenceState(m, "2026-11-30"), "PENDING");
  assert.equal(occurrenceState(m, "2026-12-01"), "OVERDUE");
  assert.equal(occurrenceState({ ...m, status: "COMPLETED" }, "2026-12-05"), "COMPLETED");
});

test("rolling 30-day thresholds and ordering", () => {
  const t = { interval_days: 30, warning_days: 21 };
  assert.equal(intervalState(null, t), "NO_RECORD");
  assert.equal(intervalState(0, t), "OK");
  assert.equal(intervalState(20, t), "OK");
  assert.equal(intervalState(21, t), "APPROACHING");
  assert.equal(intervalState(29, t), "APPROACHING");
  assert.equal(intervalState(30, t), "DUE");
  assert.equal(daysBetween("2026-10-22", "2026-11-16"), 25);
  assert.equal(daysBetween("2026-03-20", "2026-04-01"), 12); // across DST change
  const sorted = sortUnits([{ label: "שכונה 1", days_since: 3 }, { label: "שכונה 2", days_since: null }, { label: "שכונה 3", days_since: 31 }]);
  assert.deepEqual(sorted.map((u) => u.label), ["שכונה 2", "שכונה 3", "שכונה 1"]);
});

test("task validation", () => {
  assert.ok(validateTaskInput({ title: "x", recurrence_type: "WEEKLY" }).data);
  assert.equal(validateTaskInput({ title: "", recurrence_type: "WEEKLY" }).status, 400);
  assert.equal(validateTaskInput({ title: "x", recurrence_type: "DAILY" }).status, 400);
  assert.equal(validateTaskInput({ title: "x", recurrence_type: "WEEKLY", responsibility_type: "WORKER", responsible_worker_id: "someone" }).status, 400);
  assert.equal(validateTaskInput({ title: "x", recurrence_type: "MONTHLY" }, { recurrence_type: "WEEKLY" }).status, 409);
  const iv = validateTaskInput({ title: "x", recurrence_type: "EVERY_N_DAYS", interval_days: 30, warning_days: 21, units: [{ unit_key: "N1", label: "שכונה 1" }] }, { recurrence_type: "EVERY_N_DAYS", units: [{ unit_key: "N1", neighborhood_id: "nh1" }] });
  assert.equal(iv.data.units[0].neighborhood_id, "nh1");
  assert.equal(validateTaskInput({ title: "x", recurrence_type: "EVERY_N_DAYS", interval_days: 30, warning_days: 30, units: [{ unit_key: "N1", label: "a" }] }).status, 400);
  assert.equal(validateTaskInput({ title: "x", recurrence_type: "EVERY_N_DAYS", interval_days: 30, warning_days: 21, units: [{ unit_key: "N1", label: "a" }, { unit_key: "N1", label: "b" }] }).status, 400);
});

// ── In-memory datastore for the completion core ─────────────────────────────
function entity(rows) {
  let seq = 0;
  const match = (r, q) => Object.entries(q).every(([k, v]) => (v && typeof v === "object" && "$in" in v ? v.$in.includes(r[k]) : r[k] === v));
  return {
    rows,
    get: async (id) => { const r = rows.find((x) => x.id === id); if (!r) throw Object.assign(new Error("nf"), { status: 404 }); return { ...r }; },
    filter: async (q, sort, limit) => {
      const desc = sort?.startsWith("-"), key = sort?.replace(/^-/, "");
      const out = rows.filter((r) => match(r, q)).sort((a, b) => (key ? String(a[key]).localeCompare(String(b[key])) * (desc ? -1 : 1) : 0));
      return out.slice(0, limit).map((r) => ({ ...r }));
    },
    create: async (d) => { const r = { id: `e${++seq}`, ...d }; rows.push(r); return { ...r }; },
    update: async (id, d) => { const r = rows.find((x) => x.id === id); Object.assign(r, d); return { ...r }; },
  };
}
const makeDb = () => ({
  RecurringMaintenanceTask: entity([
    { id: "team", task_key: "w1", title: "פילטרים", recurrence_type: "WEEKLY", responsibility_type: "OPERATIONS_TEAM", is_active: true },
    { id: "omriTask", task_key: "m1", title: "גנרטור", recurrence_type: "MONTHLY", responsibility_type: "WORKER", responsible_worker_id: OMRI, is_active: true },
    { id: "hoods", task_key: "i1", title: "אוהלים", recurrence_type: "EVERY_N_DAYS", responsibility_type: "OPERATIONS_TEAM", is_active: true, interval_days: 30, warning_days: 21, units: [{ unit_key: "N1", label: "שכונה 1" }, { unit_key: "N2", label: "שכונה 2" }] },
  ]),
  MaintenanceTaskOccurrence: entity([
    { id: "o1", task_id: "team", title_snapshot: "פילטרים", recurrence_type: "WEEKLY", period_start: "2026-11-15", period_end: "2026-11-21", status: "PENDING" },
    { id: "o0", task_id: "team", title_snapshot: "פילטרים", recurrence_type: "WEEKLY", period_start: "2026-11-08", period_end: "2026-11-14", status: "PENDING" },
    { id: "o2", task_id: "omriTask", title_snapshot: "גנרטור", recurrence_type: "MONTHLY", period_start: "2026-11-01", period_end: "2026-11-30", status: "PENDING" },
    { id: "oFuture", task_id: "team", title_snapshot: "פילטרים", recurrence_type: "WEEKLY", period_start: "2026-11-22", period_end: "2026-11-28", status: "PENDING" },
  ]),
  MaintenanceCompletionEvent: entity([]),
});
const callerOf = (role, profile, id, name) => ({ role, profile, access: pmAccess(role, profile), internalUser: { id }, actorName: name });
const ops = callerOf("OPERATIONS", { id: "wOps", is_active: true }, "uOps", "דנה");
const admin = callerOf("ADMIN", null, "uAdmin", "מנהל");
const omri = callerOf("MAINTENANCE", { id: OMRI, is_active: true }, "uOmri", "עומרי");
const NOW = new Date("2026-11-16T10:00:00Z");
const rid = () => crypto.randomUUID();

test("completion records server identity; retries/double clicks never duplicate", async () => {
  const db = makeDb();
  const r1 = rid();
  const a = await completeOccurrence(db, ops, { occurrenceId: "o1", requestId: r1, now: NOW });
  assert.equal(a.event.completed_by_internal_user_id, "uOps");
  assert.equal(a.event.completed_by_worker_id, "wOps");
  assert.equal(a.event.completed_by_name, "דנה");
  assert.equal(a.event.completed_at, NOW.toISOString());
  assert.equal(a.event.completed_local_date, "2026-11-16");
  const replay = await completeOccurrence(db, ops, { occurrenceId: "o1", requestId: r1, now: NOW });
  assert.equal(replay.replay, true);
  const again = await completeOccurrence(db, ops, { occurrenceId: "o1", requestId: rid(), now: NOW });
  assert.equal(again.already, true);
  assert.equal(db.MaintenanceCompletionEvent.rows.length, 1);
  assert.equal((await completeOccurrence(db, admin, { occurrenceId: "o1", requestId: r1, now: NOW })).status, 409); // key reuse by other user
  const occ = db.MaintenanceTaskOccurrence.rows.find((o) => o.id === "o1");
  assert.equal(occ.status, "COMPLETED");
  assert.equal(occ.completion_event_id, a.event.id);
});

test("weekly occurrences are independent; late completion of a missed week is flagged", async () => {
  const db = makeDb();
  await completeOccurrence(db, ops, { occurrenceId: "o1", requestId: rid(), now: NOW });
  const late = await completeOccurrence(db, ops, { occurrenceId: "o0", requestId: rid(), now: NOW });
  assert.equal(late.event.completed_late, true);
  assert.equal(db.MaintenanceCompletionEvent.rows.length, 2);
  assert.equal((await completeOccurrence(db, ops, { occurrenceId: "oFuture", requestId: rid(), now: NOW })).status, 409);
});

test("Omri's tasks: Omri and admins may complete, OPERATIONS may not", async () => {
  const db = makeDb();
  assert.equal((await completeOccurrence(db, ops, { occurrenceId: "o2", requestId: rid(), now: NOW })).status, 403);
  const byOmri = await completeOccurrence(db, omri, { occurrenceId: "o2", requestId: rid(), now: NOW });
  assert.equal(byOmri.event.on_behalf_of_worker_id, null);
  assert.equal((await completeOccurrence(db, omri, { occurrenceId: "o1", requestId: rid(), now: NOW })).status, 403);
  await voidEvent(db, admin, { eventId: byOmri.event.id, reason: "טעות", now: NOW });
  const byAdmin = await completeOccurrence(db, admin, { occurrenceId: "o2", requestId: rid(), now: NOW });
  assert.equal(byAdmin.event.on_behalf_of_worker_id, OMRI);
});

test("correction preserves the original event and reopens the occurrence", async () => {
  const db = makeDb();
  const a = await completeOccurrence(db, ops, { occurrenceId: "o1", requestId: rid(), now: NOW });
  assert.equal((await voidEvent(db, ops, { eventId: a.event.id, reason: "x", now: NOW })).status, 403);
  const v = await voidEvent(db, admin, { eventId: a.event.id, reason: "סומן בטעות", now: NOW });
  assert.equal(v.event.status, "VOIDED");
  const ev = db.MaintenanceCompletionEvent.rows[0];
  assert.equal(ev.completed_by_name, "דנה");
  assert.equal(ev.voided_by_internal_user_id, "uAdmin");
  assert.equal(ev.void_reason, "סומן בטעות");
  const occ = db.MaintenanceTaskOccurrence.rows.find((o) => o.id === "o1");
  assert.equal(occ.status, "PENDING");
  assert.equal(occ.completion_event_id, null);
  assert.equal(occ.correction_count, 1);
  const redo = await completeOccurrence(db, ops, { occurrenceId: "o1", requestId: rid(), now: NOW });
  assert.ok(redo.event);
  assert.equal(db.MaintenanceCompletionEvent.rows.length, 2);
});

test("neighborhood cleanings: any order, separate events, double-submit guard", async () => {
  const db = makeDb();
  const n2 = await completeUnit(db, ops, { taskId: "hoods", unitKey: "N2", requestId: rid(), now: NOW });
  assert.equal(n2.event.unit_key, "N2");
  const dup = await completeUnit(db, ops, { taskId: "hoods", unitKey: "N2", requestId: rid(), now: new Date(NOW.getTime() + 30000) });
  assert.equal(dup.already, true);
  await completeUnit(db, ops, { taskId: "hoods", unitKey: "N1", requestId: rid(), now: NOW });
  await completeUnit(db, ops, { taskId: "hoods", unitKey: "N2", requestId: rid(), now: new Date("2026-12-10T08:00:00Z") });
  assert.equal(db.MaintenanceCompletionEvent.rows.filter((e) => e.unit_key === "N2").length, 2);
  assert.equal((await completeUnit(db, ops, { taskId: "hoods", unitKey: "N9", requestId: rid(), now: NOW })).status, 404);
  assert.equal((await completeUnit(db, omri, { taskId: "hoods", unitKey: "N1", requestId: rid(), now: NOW })).status, 403);
});