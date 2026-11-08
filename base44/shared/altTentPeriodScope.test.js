import test from "node:test";
import assert from "node:assert/strict";
import { planScopedAdd, planScopedRelease, planScopedTentReassignment, PAX_SCOPE } from "./sleepingPeriodScope.js";
import { syncSleepingNeighborhoods } from "./sleepingNeighborhoodSync.js";

// Isolated in-memory simulations of the selected-period alternative staff tent flow.
const TODAY = "2026-11-08";
const P1 = { id: "P1", group_id: "G1", start_date: "2026-11-10", end_date: "2026-11-13", status: "ACTIVE" };
const P2 = { id: "P2", group_id: "G1", start_date: "2026-11-20", end_date: "2026-11-23", status: "ACTIVE" };
const P3 = { id: "P3", group_id: "G1", start_date: "2026-11-30", end_date: "2026-12-03", status: "ACTIVE" };
const tent = (id, type = "STANDARD", capacity = 4) => ({ id, code: id, neighborhood_id: type === "VIP" ? "NV" : "N1", tent_type: type, capacity, working_status: "WORKING" });
const TENTS = [tent("T1"), tent("T2"), tent("T3"), tent("T4"), tent("V1", "VIP", 2), tent("V2", "VIP", 2)];
const otherGroupRow = (id, tentId, period) => ({ id, group_id: "G2", tent_id: tentId, neighborhood_id: "N1", arrival_date: period.start_date, departure_date: period.end_date, allocated_pax: 3, allocation_type: "STUDENT", gender_group: "BOYS", status: "CONFIRMED" });

let seq = 0;
function makeCtx(rows = []) {
  return {
    group: { id: "G1", stay_mode: "MULTI_PERIOD", operationally_active: true, status: "CONFIRMED" },
    profile: { id: "PR1", group_id: "G1", staff_count: 8, staff_alt_tent_pax: 6 },
    periods: [P1, P2, P3], tents: TENTS, neighborhoods: [], reservations: [], today: TODAY,
    rows: [...rows],
  };
}
const altBody = (periodId, tentId, pax = 3, gender = "MEN") => ({ group_id: "G1", destination_tent_id: tentId, allocated_pax: pax, allocation_type: "STAFF", gender_group: gender, notes: "__alt_tent__", edit_scope: { mode: PAX_SCOPE.ONLY, selected_period_id: periodId } });
const vipBody = (periodId, tentId, index) => ({ group_id: "G1", destination_tent_id: tentId, allocated_pax: 2, allocation_type: "STAFF", gender_group: "MEN", notes: `__vip_req_${index}__`, edit_scope: { mode: PAX_SCOPE.ONLY, selected_period_id: periodId } });
function apply(ctx, plan) {
  plan.creates.forEach(row => ctx.rows.push({ ...row, id: `R${++seq}` }));
  plan.updates.forEach(({ row, data }) => Object.assign(ctx.rows.find(r => r.id === row.id), data));
}
// Same filter the period view uses to show the alternative tent section.
const altInPeriod = (rows, periodId) => rows.filter(r => r.group_id === "G1" && r.stay_period_id === periodId && r.status !== "CANCELLED" && r.allocation_type === "STAFF" && (r.notes || "").includes("__alt_tent__"));

test("1. staff can be assigned to an alternative tent for one selected period", () => {
  const ctx = makeCtx();
  const plan = planScopedAdd(ctx, altBody("P2", "T1"));
  const active = plan.creates.filter(r => r.status !== "CANCELLED");
  assert.equal(active.length, 1);
  assert.equal(active[0].stay_period_id, "P2");
  assert.equal(active[0].tent_id, "T1");
  assert.equal(active[0].allocation_type, "STAFF");
  assert.equal(active[0].notes, "__alt_tent__");
  assert.equal(active[0].arrival_date, P2.start_date);
  assert.equal(active[0].departure_date, P2.end_date);
  assert.equal(plan.creates.some(r => r.stay_period_id === "P1"), false, "previous period untouched");
});

test("2. tent occupied in a previous period but free in the selected period succeeds", () => {
  const ctx = makeCtx([otherGroupRow("X1", "T3", P1)]);
  apply(ctx, planScopedAdd(ctx, altBody("P1", "T1"))); // own group also used T1 in P1
  assert.doesNotThrow(() => planScopedAdd(ctx, altBody("P2", "T1")));
  assert.doesNotThrow(() => planScopedAdd(ctx, altBody("P2", "T3")));
});

test("3. tent occupied during the selected period is blocked", () => {
  const ctx = makeCtx([otherGroupRow("X2", "T2", P2)]);
  assert.throws(() => planScopedAdd(ctx, altBody("P2", "T2")), /האוהל תפוס/);
  apply(ctx, planScopedAdd(ctx, altBody("P2", "T1")));
  assert.throws(() => planScopedAdd(ctx, altBody("P2", "T1")), /האוהל תפוס/, "same group cannot double-book the tent");
});

test("4. different periods can use different VIP / alternative tents", () => {
  const ctx = makeCtx();
  apply(ctx, planScopedAdd(ctx, altBody("P2", "T1")));
  apply(ctx, planScopedAdd(ctx, altBody("P3", "T3", 2, "WOMEN")));
  apply(ctx, planScopedAdd(ctx, vipBody("P2", "V1", 0)));
  apply(ctx, planScopedAdd(ctx, vipBody("P3", "V2", 0)));
  assert.deepEqual(altInPeriod(ctx.rows, "P2").map(r => r.tent_id), ["T1"]);
  assert.deepEqual(altInPeriod(ctx.rows, "P3").map(r => r.tent_id), ["T3"]);
  const vip = p => ctx.rows.filter(r => r.stay_period_id === p && r.status !== "CANCELLED" && /__vip_req_0__/.test(r.notes)).map(r => r.tent_id);
  assert.deepEqual(vip("P2"), ["V1"]);
  assert.deepEqual(vip("P3"), ["V2"]);
});

test("5. saving one period does not alter any other period", () => {
  const ctx = makeCtx();
  apply(ctx, planScopedAdd(ctx, altBody("P1", "T1")));
  apply(ctx, planScopedAdd(ctx, altBody("P3", "T4")));
  const before = JSON.stringify(ctx.rows);
  const plan = planScopedAdd(ctx, altBody("P2", "T2"));
  assert.equal(plan.updates.length, 0, "no existing row is modified");
  assert.equal(JSON.stringify(ctx.rows), before, "existing rows unchanged");
  assert.deepEqual(plan.creates.filter(r => r.status !== "CANCELLED").map(r => r.stay_period_id), ["P2"]);
  // Period release / move of the P2 alt tent also only touches P2.
  apply(ctx, plan);
  const p2Row = altInPeriod(ctx.rows, "P2")[0];
  const release = planScopedRelease(ctx, { group_id: "G1", allocation_id: p2Row.id, allocation_series_id: p2Row.allocation_series_id, edit_scope: { mode: PAX_SCOPE.ONLY, selected_period_id: "P2" } });
  assert.deepEqual(release.updates.map(u => u.row.id), [p2Row.id]);
  const move = planScopedTentReassignment(ctx, { group_id: "G1", allocation_id: p2Row.id, allocation_series_id: p2Row.allocation_series_id, destination_tent_id: "T3", edit_scope: { mode: PAX_SCOPE.ONLY, selected_period_id: "P2" } });
  assert.deepEqual([...new Set(move.creates.filter(r => r.status !== "CANCELLED").map(r => r.stay_period_id))], ["P2"]);
  assert.ok(move.updates.every(u => u.row.stay_period_id === "P2"));
});

test("6. reopening a period shows its saved assignment", () => {
  const ctx = makeCtx();
  apply(ctx, planScopedAdd(ctx, altBody("P2", "T1", 4, "MIXED")));
  apply(ctx, planScopedAdd(ctx, altBody("P3", "T2", 2, "WOMEN")));
  const p2 = altInPeriod(ctx.rows, "P2");
  assert.equal(p2.length, 1);
  assert.equal(p2[0].tent_id, "T1"); assert.equal(p2[0].allocated_pax, 4); assert.equal(p2[0].gender_group, "MIXED");
  const p3 = altInPeriod(ctx.rows, "P3");
  assert.equal(p3[0].tent_id, "T2"); assert.equal(p3[0].allocated_pax, 2);
  assert.equal(altInPeriod(ctx.rows, "P1").length, 0);
});

test("safety: VIP tent, capacity and gender are validated", () => {
  const ctx = makeCtx();
  assert.throws(() => planScopedAdd(ctx, altBody("P2", "V1", 2)), /אוהל רגיל/);
  assert.throws(() => planScopedAdd(ctx, altBody("P2", "T1", 5)), /קיבולת/);
  assert.throws(() => planScopedAdd(ctx, altBody("P2", "T1", 2, "BOYS")), /מגדר/);
  assert.throws(() => planScopedAdd(makeCtx(), { ...altBody("P2", "T1"), notes: "" }), /אינו נתמך/, "STAFF without marker still rejected");
});

test("safety: alternative tent rows never cancel neighborhood reservations", async () => {
  const altRow = { id: "A1", group_id: "G1", stay_period_id: "P2", neighborhood_id: "N1", tent_id: "T1", allocation_type: "STAFF", notes: "__alt_tent__", status: "DRAFT", arrival_date: P2.start_date, departure_date: P2.end_date };
  const reservation = { id: "NR1", group_id: "G1", stay_period_id: "P2", neighborhood_id: "N1", arrival_date: P2.start_date, departure_date: P2.end_date, status: "ACTIVE" };
  const db = { SleepingAllocation: { filter: async () => [altRow] }, NeighborhoodReservation: { filter: async () => [reservation] } };
  const calls = [];
  const writes = { update: async (...args) => calls.push(["update", ...args]), create: async (...args) => calls.push(["create", ...args]) };
  await syncSleepingNeighborhoods(db, writes, "G1", [altRow], TODAY);
  assert.equal(calls.length, 0);
});