// Run: node --test tests/workforcePolicy.test.js
// Pure-logic tests for the workforce authorization rules (no data is read or written).
import test from "node:test";
import assert from "node:assert/strict";
import {
  pickActiveInternalUser, planInternalUserSave, planInternalUserActive, planMechinaUser,
  checkWorkerIdentityChange, isWorkerLinkedTo, validateShiftInput, isSunday,
} from "../base44/shared/workforcePolicy.js";

const U = (id, email, role, active = true) => ({ id, email, role, active });
const SUPER = U("s1", "boss@x.com", "SUPER_ADMIN");
const ADMIN = U("a1", "admin@x.com", "ADMIN");
const OPS = U("o1", "ops@x.com", "OPERATIONS");
const QM = U("q1", "quotes@x.com", "QUOTES_MANAGER");
const MECH = U("m1", "Mech@X.com ", "MECHINA_USER");
const USERS = [SUPER, ADMIN, OPS, QM, MECH];

test("caller identity: normalized email, inactive ignored, conflicting roles fail closed", () => {
  assert.equal(pickActiveInternalUser(USERS, " MECH@x.com").user.id, "m1");
  assert.equal(pickActiveInternalUser([U("i", "a@x.com", "ADMIN", false)], "a@x.com").user, null);
  const r = pickActiveInternalUser([U("1", "d@x.com", "VIEWER"), U("2", "D@x.com", "ADMIN")], "d@x.com");
  assert.equal(r.user, null); assert.equal(r.conflict, true);
  assert.equal(pickActiveInternalUser([U("1", "d@x.com", "MECHINA_USER"), U("2", " d@x.com", "MECHINA_USER")], "d@x.com").user.id, "1");
  assert.equal(pickActiveInternalUser(USERS, "").user, null);
});

test("user management: only SUPER_ADMIN may save or (de)activate", () => {
  for (const caller of [ADMIN, OPS, QM, MECH]) {
    assert.equal(planInternalUserSave({ caller, users: USERS, userId: "", input: { email: "n@x.com", role: "VIEWER" } }).status, 403);
    assert.equal(planInternalUserSave({ caller, users: USERS, userId: caller.id, input: { role: "SUPER_ADMIN" } }).status, 403);
    assert.equal(planInternalUserActive({ caller, users: USERS, userId: "o1", active: false }).status, 403);
  }
});

test("user management: validation, duplicates, immutable email", () => {
  const save = (userId, input) => planInternalUserSave({ caller: SUPER, users: USERS, userId, input });
  assert.equal(save("", { email: "n@x.com", role: "ROOT" }).status, 400);
  assert.equal(save("", { email: "bad", role: "VIEWER" }).status, 400);
  assert.equal(save("", { email: " ADMIN@x.com", role: "VIEWER" }).status, 409);
  assert.equal(save("", { email: "n@x.com", role: "VIEWER", notes: "x".repeat(1001) }).status, 400);
  const created = save("", { email: " New@X.com ", name: " N ", role: "KITCHEN" });
  assert.deepEqual(created.data, { email: "new@x.com", name: "N", role: "KITCHEN", phone: "", notes: "", active: true });
  const edit = save("o1", { email: "evil@x.com", role: "VIEWER" });
  assert.equal(edit.action, "update"); assert.equal("email" in edit.data, false);
  assert.equal(save("missing", { role: "VIEWER" }).status, 404);
});

test("user management: no self role change, last SUPER_ADMIN protected", () => {
  assert.equal(planInternalUserSave({ caller: SUPER, users: USERS, userId: "s1", input: { role: "ADMIN" } }).status, 403);
  assert.equal(planInternalUserSave({ caller: SUPER, users: USERS, userId: "s1", input: { role: "SUPER_ADMIN", name: "B" } }).action, "update");
  const two = [...USERS, U("s2", "boss2@x.com", "SUPER_ADMIN")];
  assert.equal(planInternalUserSave({ caller: two[5], users: USERS.concat(two[5]), userId: "s1", input: { role: "ADMIN" } }).action, "update");
  assert.equal(planInternalUserActive({ caller: SUPER, users: USERS, userId: "s1", active: false }).status, 403);
  const other = U("s3", "boss3@x.com", "SUPER_ADMIN");
  // other is the only active super admin besides an inactive caller-less list
  assert.equal(planInternalUserActive({ caller: other, users: [U("s1", "boss@x.com", "SUPER_ADMIN"), other], userId: "s1", active: false }).action, "update");
  assert.equal(planInternalUserActive({ caller: other, users: [other, U("s1", "boss@x.com", "SUPER_ADMIN", false)], userId: "s1", active: "yes" }).status, 400);
  assert.equal(planInternalUserActive({ caller: SUPER, users: [SUPER, U("v", "v@x.com", "VIEWER", false), U("v2", "v@x.com", "ADMIN")], userId: "v", active: true }).status, 409);
});

test("mechina flow: only MECHINA_USER rows, never other roles, never self", () => {
  for (const caller of [QM, MECH, U("k", "k@x.com", "KITCHEN")]) {
    assert.equal(planMechinaUser({ caller, users: USERS, email: "new@x.com" }).status, 403);
  }
  for (const caller of [SUPER, ADMIN, OPS]) {
    const created = planMechinaUser({ caller, users: USERS, email: " New@x.com", name: "N" });
    assert.equal(created.action, "create"); assert.equal(created.data.role, "MECHINA_USER"); assert.equal(created.data.email, "new@x.com");
  }
  assert.equal(planMechinaUser({ caller: ADMIN, users: USERS, email: "ops@x.com" }).status, 409);
  assert.equal(planMechinaUser({ caller: ADMIN, users: USERS, email: "quotes@x.com" }).status, 409);
  assert.equal(planMechinaUser({ caller: ADMIN, users: [...USERS, U("k", "k@x.com", "KITCHEN", false)], email: "k@x.com" }).status, 409);
  assert.equal(planMechinaUser({ caller: ADMIN, users: USERS, email: "ADMIN@x.com" }).status, 403);
  const reactivated = planMechinaUser({ caller: OPS, users: [...USERS, U("m2", "old@x.com", "MECHINA_USER", false)], email: "old@x.com" });
  assert.deepEqual(reactivated, { action: "update", id: "m2", data: { name: "", role: "MECHINA_USER", active: true } });
  assert.equal(planMechinaUser({ caller: OPS, users: USERS, email: "mech@x.com", name: "M" }).id, "m1");
});

test("worker identity: managers cannot link, relink or unlink their own worker profile", () => {
  const own = { id: "w1", internal_user_id: "a1", internal_user_email: "admin@x.com" };
  const other = { id: "w2", internal_user_id: "o1", internal_user_email: "ops@x.com" };
  assert.equal(checkWorkerIdentityChange({ caller: ADMIN, existingWorker: own, linkedUser: null }).status, 403);
  assert.equal(checkWorkerIdentityChange({ caller: ADMIN, existingWorker: own, linkedUser: OPS }).status, 403);
  assert.equal(checkWorkerIdentityChange({ caller: ADMIN, existingWorker: own, linkedUser: ADMIN }), null);
  assert.equal(checkWorkerIdentityChange({ caller: ADMIN, existingWorker: other, linkedUser: ADMIN }).status, 403);
  assert.equal(checkWorkerIdentityChange({ caller: ADMIN, existingWorker: null, linkedUser: { ...ADMIN, email: " ADMIN@X.com" } }).status, 403);
  assert.equal(checkWorkerIdentityChange({ caller: ADMIN, existingWorker: other, linkedUser: QM }), null);
  assert.equal(checkWorkerIdentityChange({ caller: ADMIN, existingWorker: null, linkedUser: null }), null);
  assert.equal(isWorkerLinkedTo({ internal_user_id: "", internal_user_email: "admin@x.com" }, ADMIN), true);
  assert.equal(isWorkerLinkedTo({ internal_user_id: "", internal_user_email: "" }, ADMIN), false);
});

test("shift validation: week bounds, row rules, overnight allowed, label derived on server", () => {
  const W = "2026-11-08";
  assert.equal(isSunday(W), true); assert.equal(isSunday("2026-11-09"), false); assert.equal(isSunday("2026-02-30"), false);
  assert.equal(validateShiftInput({ row_type: "X", date: W }, W).status, 400);
  assert.equal(validateShiftInput({ row_type: "MAINTENANCE", date: "2026-11-15", start_time: "08:00", end_time: "16:00", worker_id: "w" }, W).status, 400);
  const night = validateShiftInput({ row_type: "OPERATIONS_EVENING", date: "2026-11-14", start_time: "22:00", end_time: "06:00", worker_id: "w", row_label: "HACK" }, W);
  assert.equal(night.needsWorker, true); assert.equal(night.payload.row_label, "תפעול ערב"); assert.equal(night.payload.row_order, 5);
  assert.equal(validateShiftInput({ row_type: "OPERATIONS_MORNING", date: W, start_time: "7:00", end_time: "16:00", worker_id: "w" }, W).status, 400);
  assert.equal(validateShiftInput({ row_type: "OPERATIONS_MORNING", date: W, start_time: "07:00", end_time: "16:00" }, W).status, 400);
  assert.equal(validateShiftInput({ row_type: "HOUSEKEEPING_MORNING", date: W, worker_count: 0 }, W).status, 400);
  const clean = validateShiftInput({ row_type: "HOUSEKEEPING_MORNING", date: W, worker_count: 4, worker_id: "ignored" }, W);
  assert.equal(clean.needsWorker, false); assert.equal(clean.payload.worker_count, 4);
  assert.equal(validateShiftInput({ row_type: "PLANNED_ACTIVITY", date: W, notes: " " }, W).status, 400);
  assert.equal(validateShiftInput({ row_type: "PLANNED_ACTIVITY", date: W, notes: "ביקור" }, W).payload.start_time, "");
  assert.equal(validateShiftInput({ row_type: "NIGHT_ON_CALL", date: W, start_time: "22:00", end_time: "07:00", worker_id: "w", status: "BOGUS" }, W).payload.status, "PLANNED");
});