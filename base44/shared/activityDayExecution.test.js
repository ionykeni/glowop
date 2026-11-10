import test from "node:test";
import assert from "node:assert/strict";
import { isExecutionKey, planFingerprintSource, classifyPreview, buildScheduleItemPayload, reconcileStation, executionCounts, activityName, pendingStationIds, writePendingStations } from "./activityDayExecution.js";
import { evaluateStationSpace } from "./activityDayPlanning.js";
import { buildSpaceCalendar } from "./spaceCalendarModel.js";

const KEYS = ["needs_projector", "chairs_count", "logistics_other"];
const exec = { date: "2026-11-12", template_name: "כאן על פני האדמה", template_version: 2 };
const station = {
  station_id: "s1", title: "סדנה", space_id: "sp1", space_code: "bunker_1", start_time: "09:00", end_time: "10:00",
  shared_activity_id: "shared-1", logistics: { needs_projector: true, chairs_count: 30 },
  groups: [{ group_id: "gA", group_name: "אשקלון" }, { group_id: "gB", group_name: "ערד" }, { group_id: "gC", group_name: "אחריי" }],
};

test("execution key must be a UUID", () => {
  assert.equal(isExecutionKey(crypto.randomUUID()), true);
  assert.equal(isExecutionKey("abc"), false);
  assert.equal(isExecutionKey(undefined), false);
});

test("fingerprint ignores group order but changes with the plan", () => {
  const a = planFingerprintSource("t", 1, "2026-11-12", [{ station_id: "s1", title: "x", start_time: "09:00", end_time: "10:00", space_id: "sp", groups: [{ group_id: "a" }, { group_id: "b" }] }]);
  const b = planFingerprintSource("t", 1, "2026-11-12", [{ station_id: "s1", title: "x", start_time: "09:00", end_time: "10:00", space_id: "sp", groups: [{ group_id: "b" }, { group_id: "a" }] }]);
  const c = planFingerprintSource("t", 1, "2026-11-13", [{ station_id: "s1", title: "x", start_time: "09:00", end_time: "10:00", space_id: "sp", groups: [{ group_id: "a" }] }]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("pending requests are warnings, booked/unavailable/unverifiable are blockers", () => {
  const { blockers, warnings } = classifyPreview([
    { station_id: "1", issues: [{ status: "PENDING", message: "p" }] },
    { station_id: "2", issues: [{ status: "BOOKED", message: "b" }] },
    { station_id: "3", issues: [{ status: "UNAVAILABLE", message: "u" }] },
    { station_id: "4", issues: [{ status: "UNVERIFIABLE", message: "v" }] },
    { station_id: "5", issues: [] },
  ]);
  assert.deepEqual(blockers.map(b => b.station_id), ["2", "3", "4"]);
  assert.deepEqual(warnings.map(w => w.station_id), ["1"]);
});

test("one shared_activity_id per station; one item per group, no pax", () => {
  const items = station.groups.map(g => buildScheduleItemPayload({ station, groupId: g.group_id, profileId: `p-${g.group_id}`, execution: exec, logisticsKeys: KEYS }));
  assert.equal(new Set(items.map(i => i.shared_activity_id)).size, 1);
  assert.deepEqual(items.map(i => i.group_id), ["gA", "gB", "gC"]);
  for (const i of items) {
    assert.equal(i.activity_space_id, "sp1");
    assert.equal(i.pax, null);
    assert.equal(i.is_shared_activity, true);
    assert.equal(i.status, "ACTIVE");
    assert.equal(i.activity_name, "כאן על פני האדמה — סדנה");
    assert.equal(i.needs_projector, true);
    assert.equal(i.chairs_count, 30);
    assert.deepEqual(JSON.parse(i.shared_activity_group_ids), ["gA", "gB", "gC"]);
  }
  assert.equal(activityName("", ""), "פעילות");
});

test("recovery adopts already-persisted items and only reports truly missing groups", () => {
  const partial = { ...station, items: { gA: "i1" } };
  const existing = [
    { id: "i2", group_id: "gB", shared_activity_id: "shared-1", status: "ACTIVE" }, // created, response lost
    { id: "x", group_id: "gC", shared_activity_id: "other", status: "ACTIVE" },      // unrelated activity
    { id: "y", group_id: "gC", shared_activity_id: "shared-1", status: "CANCELLED" },
  ];
  const { items, missing } = reconcileStation(partial, existing);
  assert.deepEqual(items, { gA: "i1", gB: "i2" });
  assert.deepEqual(missing, ["gC"]);
  const full = reconcileStation({ ...station, items: { gA: "1", gB: "2", gC: "3" } }, []);
  assert.deepEqual(full.missing, []);
});

test("counts distinguish complete and incomplete stations", () => {
  const c = executionCounts([{ ...station, items: { gA: "1", gB: "2", gC: "3" } }, { ...station, station_id: "s2", items: { gA: "4" } }]);
  assert.deepEqual(c, { expected_items: 6, created_items: 4, completed_stations: 1, total_stations: 2 });
});

test("own shared items do not self-conflict once excluded; a different activity in the same room does", () => {
  const ctx = (groupItems) => ({ date: "2026-11-12", spacesById: { sp1: { id: "sp1", is_bookable: true, working_status: "WORKING" } }, blocks: [], groupItems, standalone: [], standaloneSpaceIdsByReservation: {}, pendingRequests: [], stations: [station] });
  const own = { activity_space_id: "sp1", status: "ACTIVE", start_time: "09:00", end_time: "10:00", shared_activity_id: "shared-1" };
  const other = { activity_space_id: "sp1", status: "ACTIVE", start_time: "09:30", end_time: "10:30", shared_activity_id: "zzz", activity_name: "אחר" };
  const excluded = [own, other].filter(i => i.shared_activity_id !== "shared-1");
  assert.deepEqual(evaluateStationSpace(station, ctx(excluded)).map(i => i.code), ["GROUP_SCHEDULE_ITEM"]);
  assert.deepEqual(evaluateStationSpace(station, ctx([])), []);
});

test("a shared station with three groups renders as ONE occupancy in the visual calendar", () => {
  const groups = ["gA", "gB", "gC"].map((id, i) => ({ id, group_name: station.groups[i].group_name, status: "CONFIRMED" }));
  const scheduleItems = groups.map((g, i) => ({ id: `i${i}`, group_id: g.id, activity_space_id: "sp1", date: exec.date, start_time: "09:00", end_time: "10:00", status: "ACTIVE", activity_name: "x", shared_activity_id: "shared-1" }));
  const cal = buildSpaceCalendar({ spaces: [{ id: "sp1", name: "חדר 1" }], scheduleItems, groups, start: exec.date, end: exec.date });
  const events = cal.events.filter(e => e.kind === "GROUP");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].group_names, ["אשקלון", "ערד", "אחריי"]);
});

// In-memory datastore. A thrown create simulates a server interruption: nothing after it runs (no catch-path persist).
function fakeStore(journal, items = []) {
  const db = { journal, items: [...items], seq: 0, creates: 0, failAfter: Infinity };
  const deps = {
    findExisting: async (st) => db.items.filter(i => i.shared_activity_id === st.shared_activity_id),
    createItem: async (st, gid) => {
      if (db.creates >= db.failAfter) throw new Error("INTERRUPTED");
      db.creates++;
      const row = { id: `new${++db.seq}`, group_id: gid, shared_activity_id: st.shared_activity_id, status: "ACTIVE" };
      db.items.push(row);
      return row;
    },
    persist: async (json) => { db.journal = json; },
  };
  const resume = () => {
    const stations = JSON.parse(db.journal);
    return writePendingStations({ stations, pendingIds: pendingStationIds(stations), ...deps });
  };
  return { db, resume };
}
const st = (id, gids, items = {}) => ({ station_id: id, shared_activity_id: `shared-${id}`, groups: gids.map(g => ({ group_id: g, group_name: g })), items });
const assertNoDuplicates = (items) => {
  const keys = items.map(i => `${i.shared_activity_id}|${i.group_id}`);
  assert.equal(new Set(keys).size, keys.length);
};

test("REGRESSION: interrupted resume keeps the full journal; a second resume completes without duplicates", async () => {
  const journal = JSON.stringify([
    st("A", ["g1", "g2"], { g1: "a1", g2: "a2" }), // completed
    st("B", ["g1", "g2", "g3"], { g1: "b1" }),     // partial; b2 exists but its response was lost
    st("C", ["g1", "g2"]),                          // not started
  ]);
  const { db, resume } = fakeStore(journal, [
    { id: "a1", group_id: "g1", shared_activity_id: "shared-A", status: "ACTIVE" },
    { id: "a2", group_id: "g2", shared_activity_id: "shared-A", status: "ACTIVE" },
    { id: "b1", group_id: "g1", shared_activity_id: "shared-B", status: "ACTIVE" },
    { id: "b2", group_id: "g2", shared_activity_id: "shared-B", status: "ACTIVE" },
  ]);

  // Resume #1: B is finished (adopts b2, creates g3) and persisted, then the server dies inside C.
  db.failAfter = 1;
  await assert.rejects(resume(), /INTERRUPTED/);
  const mid = JSON.parse(db.journal);
  assert.deepEqual(mid.map(s => s.station_id), ["A", "B", "C"]); // the old bug persisted only [B]
  assert.deepEqual(mid[0].items, { g1: "a1", g2: "a2" });
  assert.equal(mid[0].shared_activity_id, "shared-A");
  assert.deepEqual(Object.keys(mid[1].items).sort(), ["g1", "g2", "g3"]);
  assert.equal(mid[1].items.g2, "b2");
  assertNoDuplicates(db.items);

  // Resume #2 rebuilds from the stored journal and only creates what is truly missing.
  db.failAfter = Infinity;
  await resume();
  const final = JSON.parse(db.journal);
  assert.deepEqual(final.map(s => [s.station_id, s.shared_activity_id]), [["A", "shared-A"], ["B", "shared-B"], ["C", "shared-C"]]);
  assert.deepEqual(final[0].items, { g1: "a1", g2: "a2" });
  assert.deepEqual({ g1: final[1].items.g1, g2: final[1].items.g2 }, { g1: "b1", g2: "b2" });
  assert.equal(pendingStationIds(final).size, 0);
  assert.equal(db.items.length, 2 + 3 + 2);
  assert.equal(db.creates, 3); // B.g3, C.g1, C.g2 — nothing recreated
  assertNoDuplicates(db.items);
});

test("interruption inside a batch: successful sibling creates are adopted on the next resume", async () => {
  const { db, resume } = fakeStore(JSON.stringify([st("A", ["g1", "g2", "g3"])]));
  db.failAfter = 2; // g1, g2 created; g3 fails
  await assert.rejects(resume(), /INTERRUPTED/);
  db.failAfter = Infinity;
  await resume();
  assert.equal(db.items.length, 3);
  assertNoDuplicates(db.items);
  assert.equal(pendingStationIds(JSON.parse(db.journal)).size, 0);
});

test("normal execution creates every item once; replay creates nothing", async () => {
  const { db, resume } = fakeStore(JSON.stringify([st("A", ["g1", "g2"]), st("B", ["g3"])]));
  await resume();
  const j = JSON.parse(db.journal);
  assert.equal(j.length, 2);
  assert.equal(db.items.length, 3);
  assert.equal(pendingStationIds(j).size, 0);
  await resume();
  assert.equal(db.items.length, 3);
  assert.deepEqual(JSON.parse(db.journal), j);
});