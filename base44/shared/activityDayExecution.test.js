import test from "node:test";
import assert from "node:assert/strict";
import { isExecutionKey, planFingerprintSource, classifyPreview, buildScheduleItemPayload, reconcileStation, executionCounts, activityName } from "./activityDayExecution.js";
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