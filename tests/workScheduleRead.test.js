// Run: node --test tests/
// SIMULATED role tests for the read-only schedule endpoint (getWorkScheduleView) using an in-memory client.
import test from "node:test";
import assert from "node:assert/strict";
import { handleWorkScheduleRead } from "../base44/shared/workScheduleRead.js";
import { mockBase44 } from "./helpers/mockBase44.js";

const IU = (id, email, role, active = true) => ({ id, email, role, active });
const DRAFT_WEEK = "2026-11-08";
const PUB_WEEK = "2026-11-15";

const data = () => ({
  InternalUser: [
    IU("u-super", "boss@x.com", "SUPER_ADMIN"), IU("u-admin", "admin@x.com", "ADMIN"), IU("u-ops", "ops@x.com", "OPERATIONS"),
    IU("u-ops2", "ops2@x.com", "OPERATIONS"), IU("u-kitchen", "k@x.com", "KITCHEN"), IU("u-mech", "Mech@X.com", "MECHINA_USER"),
    IU("u-off", "off@x.com", "ADMIN", false), IU("u-c1", "dup@x.com", "VIEWER"), IU("u-c2", "DUP@x.com", "ADMIN"),
  ],
  WorkerProfile: [
    { id: "w-admin", full_name: "Admin Worker", is_active: true, internal_user_id: "u-admin", phone: "050", email: "admin@x.com", notes: "private" },
    { id: "w-ops", full_name: "Ops Worker", is_active: true, internal_user_id: "u-ops" },
    { id: "w-mech", full_name: "Mech Worker", is_active: true, internal_user_id: "u-mech" },
  ],
  WorkSchedule: [
    { id: "s-draft", week_start_date: DRAFT_WEEK, status: "DRAFT", created_by: "boss@x.com" },
    { id: "s-pub", week_start_date: PUB_WEEK, status: "PUBLISHED", published_at: "2026-11-14T10:00:00Z", created_by: "boss@x.com" },
  ],
  WorkShift: [
    { id: "d1", work_schedule_id: "s-draft", date: "2026-11-09", row_type: "OPERATIONS_MORNING", worker_id: "w-ops", worker_name: "Ops Worker", start_time: "07:00", end_time: "15:00", status: "PLANNED", created_by: "boss@x.com", updated_by: "boss@x.com" },
    { id: "p1", work_schedule_id: "s-pub", date: "2026-11-16", row_type: "OPERATIONS_EVENING", worker_id: "w-admin", worker_name: "Admin Worker", start_time: "15:00", end_time: "23:00", status: "PLANNED", notes: "n", created_by: "boss@x.com" },
    { id: "p2", work_schedule_id: "s-pub", date: "2026-11-16", row_type: "NIGHT_ON_CALL", worker_id: "w-admin", worker_name: "", start_time: "23:00", end_time: "07:00", status: "PLANNED", linked_source_shift_id: "p1", auto_created_from: "OPERATIONS_EVENING_TO_NIGHT_ON_CALL" },
    { id: "p3", work_schedule_id: "s-pub", date: "2026-11-17", row_type: "MAINTENANCE", worker_id: "w-ops", worker_name: "Ops Worker", start_time: "08:00", end_time: "16:00", status: "PLANNED" },
    { id: "p4", work_schedule_id: "s-pub", date: "2026-11-18", row_type: "OPERATIONS_MORNING", worker_id: "w-admin", worker_name: "Admin Worker", start_time: "07:00", end_time: "15:00", status: "CANCELLED" },
    { id: "d2", work_schedule_id: "s-draft", date: "2026-11-16", row_type: "OPERATIONS_MORNING", worker_id: "w-ops", worker_name: "Ops Worker", start_time: "07:00", end_time: "15:00", status: "PLANNED" },
  ],
});

const call = async (email, body) => {
  const res = await handleWorkScheduleRead(mockBase44({ email, data: data() }), body);
  return { status: res.status, body: await res.json() };
};
const FORBIDDEN_KEYS = ["created_by", "updated_by", "phone", "email", "internal_user_id", "internal_user_email"];
const assertNoPrivateKeys = (rows) => rows.forEach((r) => FORBIDDEN_KEYS.forEach((k) => assert.equal(k in r, false, `leaked ${k}`)));

test("auth: unauthenticated 401, unknown / inactive / conflicting identity 403", async () => {
  assert.equal((await call(null, { action: "week", week_start_date: PUB_WEEK })).status, 401);
  assert.equal((await call("stranger@x.com", { action: "week", week_start_date: PUB_WEEK })).status, 403);
  assert.equal((await call("off@x.com", { action: "week", week_start_date: PUB_WEEK })).status, 403);
  assert.equal((await call("dup@x.com", { action: "week", week_start_date: PUB_WEEK })).status, 403);
});

test("MECHINA_USER is rejected on every workforce view, even with a worker profile", async () => {
  for (const body of [{ action: "week", week_start_date: PUB_WEEK }, { action: "my_week", week_start_date: PUB_WEEK }, { action: "dashboard_day", date: "2026-11-16" }]) {
    assert.equal((await call("mech@x.com", body)).status, 403);
  }
});

test("manager week view: drafts visible, full grid fields incl. worker_id, no audit emails", async () => {
  const draft = await call("BOSS@x.com ", { action: "week", week_start_date: DRAFT_WEEK });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.schedule.status, "DRAFT");
  assert.deepEqual(draft.body.shifts.map((s) => s.id), ["d1", "d2"]);
  assert.equal(draft.body.shifts[0].worker_id, "w-ops");
  assertNoPrivateKeys(draft.body.shifts);
  assert.equal("created_by" in draft.body.schedule, false);
  const pub = await call("admin@x.com", { action: "week", week_start_date: PUB_WEEK });
  const night = pub.body.shifts.find((s) => s.id === "p2");
  assert.equal(night.linked_source_shift_id, "p1");
  assert.equal(night.auto_created_from, "OPERATIONS_EVENING_TO_NIGHT_ON_CALL");
  assert.equal(pub.body.shifts.length, 4); // cancelled rows still returned to the grid, as before
});

test("non-manager viewer: draft weeks hidden, published grid without worker_id", async () => {
  const draft = await call("ops@x.com", { action: "week", week_start_date: DRAFT_WEEK });
  assert.equal(draft.status, 200); assert.equal(draft.body.schedule, null); assert.deepEqual(draft.body.shifts, []);
  const pub = await call("ops@x.com", { action: "week", week_start_date: PUB_WEEK });
  assert.equal(pub.body.schedule.status, "PUBLISHED");
  assert.equal(pub.body.shifts.every((s) => !("worker_id" in s)), true);
  assertNoPrivateKeys(pub.body.shifts);
});

test("roles without schedule view (KITCHEN) cannot read the weekly grid; bad input rejected", async () => {
  assert.equal((await call("k@x.com", { action: "week", week_start_date: PUB_WEEK })).status, 403);
  assert.equal((await call("boss@x.com", { action: "week", week_start_date: "2026-11-16" })).status, 400);
  assert.equal((await call("boss@x.com", { action: "nope" })).status, 400);
});

test("my_week: ADMIN worker sees only own published PLANNED shifts; client worker_id ignored", async () => {
  const mine = await call("admin@x.com", { action: "my_week", week_start_date: PUB_WEEK, worker_id: "w-ops" });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.shifts.map((s) => s.id), ["p1", "p2"]); // p3 belongs to w-ops, p4 cancelled
  assert.equal(mine.body.profile.id, "w-admin");
  mine.body.shifts.forEach((s) => ["worker_id", "worker_name", "work_schedule_id"].forEach((k) => assert.equal(k in s, false)));
  assertNoPrivateKeys(mine.body.shifts);
});

test("my_week: employee self-service, drafts never shown, no profile -> empty", async () => {
  const ops = await call("ops@x.com", { action: "my_week", week_start_date: PUB_WEEK });
  assert.deepEqual(ops.body.shifts.map((s) => s.id), ["p3"]);
  const draft = await call("ops@x.com", { action: "my_week", week_start_date: DRAFT_WEEK });
  assert.equal(draft.body.schedule, null); assert.deepEqual(draft.body.shifts, []);
  const none = await call("ops2@x.com", { action: "my_week", week_start_date: PUB_WEEK });
  assert.deepEqual(none.body, { profile: null, schedule: null, shifts: [] });
  const kitchen = await call("k@x.com", { action: "my_week", week_start_date: PUB_WEEK });
  assert.equal(kitchen.body.profile, null);
});

test("dashboard_day: operations rows only, names resolved, drafts for managers only", async () => {
  const mgr = await call("boss@x.com", { action: "dashboard_day", date: "2026-11-16" });
  assert.deepEqual(mgr.body.shifts.map((s) => s.id).sort(), ["d2", "p1", "p2"]);
  assert.equal(mgr.body.shifts.find((s) => s.id === "p2").worker_name, "Admin Worker");
  mgr.body.shifts.forEach((s) => assert.deepEqual(Object.keys(s).sort(), ["end_time", "id", "row_type", "start_time", "worker_name"]));
  const viewer = await call("k@x.com", { action: "dashboard_day", date: "2026-11-16" });
  assert.deepEqual(viewer.body.shifts.map((s) => s.id).sort(), ["p1", "p2"]);
  const maint = await call("ops@x.com", { action: "dashboard_day", date: "2026-11-17" });
  assert.deepEqual(maint.body.shifts, []); // MAINTENANCE row is not a dashboard row
  assert.equal((await call("k@x.com", { action: "dashboard_day", date: "16/11/2026" })).status, 400);
});