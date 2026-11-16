// Run: node --test tests/
// Regression tests for case-insensitive Mechina identity matching (SIMULATED data only).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveActiveInternalUser, assignmentsForEmail, reportAccess, handleMyMechinaAssignments } from "../base44/shared/mechinaAccess.js";
import { mockBase44 } from "./helpers/mockBase44.js";

const IU = (id, email, role, active = true) => ({ id, email, role, active });
// Mirrors the live pattern: an active legacy row with typed casing + an older inactive lowercase row.
const USERS = [IU("old", "boost@x.org", "MECHINA_USER", false), IU("cur", "Boost@x.org", "MECHINA_USER"), IU("adm", "ops@x.com", "OPERATIONS"), IU("k", "k@x.com", "KITCHEN")];
const ASSIGN = [
  { id: "a1", user_email: "Boost@x.org", group_id: "g1", group_name: "G1", is_active: true, notes: "secret" },
  { id: "a2", user_email: "other@x.org", group_id: "g2", group_name: "G2", is_active: true },
  { id: "a3", user_email: "boost@x.org", group_id: "g3", group_name: "G3", is_active: false },
];

test("internal user: active legacy-cased row wins over inactive lowercase duplicate", () => {
  assert.equal(resolveActiveInternalUser(USERS, "boost@x.org").id, "cur");
  assert.equal(resolveActiveInternalUser([IU("i", "a@x.com", "ADMIN", false)], "a@x.com"), null);
  assert.equal(resolveActiveInternalUser([IU("1", "c@x.com", "VIEWER"), IU("2", "C@x.com", "ADMIN")], "c@x.com"), null);
});

test("assignments match case-insensitively and exclude inactive / other users", () => {
  assert.deepEqual(assignmentsForEmail(ASSIGN, "boost@x.org").map((a) => a.id), ["a1"]);
  assert.deepEqual(assignmentsForEmail(ASSIGN, ""), []);
});

test("sleeping-report access: legacy-cased MECHINA_USER reaches own group only; admins any group", () => {
  const boost = resolveActiveInternalUser(USERS, "boost@x.org");
  assert.equal(reportAccess({ internal: boost, assignments: ASSIGN, email: "boost@x.org", groupId: "g1" }).allowed, true);
  assert.equal(reportAccess({ internal: boost, assignments: ASSIGN, email: "boost@x.org", groupId: "g2" }).allowed, false);
  assert.equal(reportAccess({ internal: boost, assignments: ASSIGN, email: "boost@x.org", groupId: "g3" }).allowed, false);
  assert.equal(reportAccess({ internal: boost, assignments: ASSIGN, email: "boost@x.org", groupId: null }).allowed, false);
  const ops = resolveActiveInternalUser(USERS, "ops@x.com");
  assert.deepEqual(reportAccess({ internal: ops, assignments: [], email: "ops@x.com", groupId: "g2" }), { isAdmin: true, allowed: true });
  const kitchen = resolveActiveInternalUser(USERS, "k@x.com");
  assert.equal(reportAccess({ internal: kitchen, assignments: ASSIGN, email: "k@x.com", groupId: "g1" }).allowed, false);
  assert.equal(reportAccess({ internal: null, assignments: ASSIGN, email: "boost@x.org", groupId: "g1" }).allowed, false);
});

test("getMyMechinaAssignments: own rows only, minimum fields, non-Mechina roles rejected", async () => {
  const run = async (email) => {
    const res = await handleMyMechinaAssignments(mockBase44({ email, data: { InternalUser: USERS, MechinaGroupAssignment: ASSIGN } }));
    return { status: res.status, body: await res.json() };
  };
  const mine = await run("boost@x.org");
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.assignments, [{ id: "a1", group_id: "g1", group_name: "G1", is_active: true }]);
  assert.equal((await run("ops@x.com")).status, 403);
  assert.equal((await run(null)).status, 401);
});