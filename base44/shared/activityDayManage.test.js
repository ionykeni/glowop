// Phase C2 isolated tests (MOCK datastore — no real records, no Google). Run: node --test base44/shared/activityDayManage.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { commit, resume, previewEdit, previewCancel } from "./activityDayOperations.js";
import { summarizeExecution, presentExecution } from "./activityDayManage.js";
import { normalizeEditTarget, planStationApply, stationLiveState, startOperationQuery } from "./activityDayEdit.js";
import { compareEvent, cancelledItemState } from "./activityDayCalendarCheck.js";
import { buildSpaceCalendar } from "./spaceCalendarModel.js";

const DATE = "2030-03-10", TODAY = "2030-03-01";
const TRIGGER = ["activity_space_id", "status", "date", "start_time", "end_time", "activity_name", "pax"];
let seq = 0;
const newId = () => (++seq).toString(16).padStart(24, "a");
const uuid = () => crypto.randomUUID();

function matches(row, q) {
  return Object.entries(q || {}).every(([k, v]) => {
    if (k === "$or") return v.some(sub => matches(row, sub));
    const val = row[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("$in" in v) return v.$in.some(x => (x === null ? val === undefined || val === null : x === val));
      if ("$exists" in v) return v.$exists ? val !== undefined : val === undefined;
      if ("$lte" in v && !(val <= v.$lte)) return false;
      if ("$gte" in v && !(val >= v.$gte)) return false;
      return true;
    }
    return v === null ? val === undefined || val === null : val === v;
  });
}

// In-memory datastore. GroupScheduleItem writes feed a fake mirror that behaves like the existing per-record
// calendar workflow (create/update of trigger fields -> upsert event; CANCELLED -> delete). Bulk writes never fire it.
function makeStore() {
  const tables = {}; const mirror = {}; const failOn = { create: Infinity, update: Infinity }; const calls = { create: 0, update: 0 };
  const spaceName = (id) => tables.ActivitySpace?.find(s => s.id === id)?.name;
  const fireMirror = (row, changed) => {
    if (row.status === "CANCELLED") { delete mirror[row.id]; return; }
    if (changed.some(f => TRIGGER.includes(f))) mirror[row.id] = { start: { dateTime: `${row.date}T${row.start_time}:00+02:00` }, end: { dateTime: `${row.date}T${row.end_time}:00+02:00` }, location: spaceName(row.activity_space_id), summary: `${row.activity_name} – g` };
  };
  const entity = (name) => {
    const rows = (tables[name] ||= []);
    return {
      filter: async (q) => rows.filter(r => matches(r, q)).map(r => ({ ...r })),
      list: async () => rows.map(r => ({ ...r })),
      get: async (id) => { const r = rows.find(x => x.id === id); if (!r) throw Object.assign(new Error("nf"), { status: 404 }); return { ...r }; },
      create: async (data) => {
        if (name === "GroupScheduleItem" && ++calls.create > failOn.create) throw new Error("INTERRUPTED");
        const row = { id: newId(), created_date: new Date(Date.now() + seq).toISOString(), ...data };
        rows.push(row);
        if (name === "GroupScheduleItem") fireMirror(row, Object.keys(data));
        return { ...row };
      },
      update: async (id, patch) => {
        if (name === "GroupScheduleItem" && ++calls.update > failOn.update) throw new Error("INTERRUPTED");
        const row = rows.find(x => x.id === id);
        const changed = Object.keys(patch).filter(k => row[k] !== patch[k]);
        Object.assign(row, patch);
        if (name === "GroupScheduleItem") fireMirror(row, changed);
        return { ...row };
      },
      updateMany: async (q, ops) => {
        if (name === "GroupScheduleItem") throw new Error("bulk writes would bypass the calendar workflow");
        const hit = rows.filter(r => matches(r, q));
        for (const r of hit) { Object.assign(r, ops.$set || {}); for (const k of Object.keys(ops.$unset || {})) delete r[k]; }
        return { updated: hit.length };
      },
    };
  };
  const db = new Proxy({}, { get: (_, name) => entity(name) });
  return { db, base44: { asServiceRole: { entities: db } }, tables, mirror, failOn, calls };
}

async function seed() {
  const s = makeStore();
  const { db } = s;
  const sp = {};
  for (const [k, name] of [["mamad", "ממ״ד 1"], ["room6", "חדר 6"], ["room1", "חדר 1"], ["busy", "חדר תפוס"]]) sp[k] = (await db.ActivitySpace.create({ name, code: k, is_bookable: true, working_status: "WORKING" })).id;
  sp.closed = (await db.ActivitySpace.create({ name: "סגור", code: "closed", is_bookable: false, working_status: "WORKING" })).id; // no capacity field anywhere
  const g = {};
  for (const [k, name, extra] of [["ash", "אשקלון", {}], ["arad", "ערד", {}], ["ach", "אחריי", {}], ["galil", "גליל עליון", {}], ["dayuse", "יום כיף", { group_type: "DAY_USE", arrival_date: DATE, departure_date: DATE }], ["gone", "לא באתר", { arrival_date: "2030-03-20", departure_date: "2030-03-22" }]]) {
    g[k] = (await db.Group.create({ group_name: name, status: "CONFIRMED", arrival_date: "2030-03-09", departure_date: "2030-03-12", ...extra })).id;
    await db.OperationalGroupProfile.create({ group_id: g[k] });
  }
  const shared = uuid(), shared2 = uuid();
  const mk = (gid, sid, space, t0, t1) => db.GroupScheduleItem.create({ group_id: gid, operational_group_profile_id: "p", date: DATE, start_time: t0, end_time: t1, activity_name: "יום — סדנה", activity_space_id: space, shared_activity_id: sid, is_shared_activity: true, status: "ACTIVE", source: "manual" });
  const items = {};
  for (const k of ["ash", "arad", "ach"]) items[k] = (await mk(g[k], shared, sp.mamad, "09:00", "10:00")).id;
  const items2 = {};
  for (const k of ["ash"]) items2[k] = (await mk(g[k], shared2, sp.room1, "10:00", "11:00")).id;
  // Unrelated confirmed activities: one blocking room "busy" at 10:00-11:00.
  const unrelated = await db.GroupScheduleItem.create({ group_id: g.galil, operational_group_profile_id: "p", date: DATE, start_time: "10:00", end_time: "11:00", activity_name: "אחר", activity_space_id: sp.busy, status: "ACTIVE", source: "manual" });
  const stations = [
    { station_id: "s1", title: "סדנה", start_time: "09:00", end_time: "10:00", space_id: sp.mamad, space_name: "ממ״ד 1", shared_activity_id: shared, logistics: {}, groups: ["ash", "arad", "ach"].map(k => ({ group_id: g[k], group_name: k })), items: Object.fromEntries(["ash", "arad", "ach"].map(k => [g[k], items[k]])) },
    { station_id: "s2", title: "הרצאה", start_time: "10:00", end_time: "11:00", space_id: sp.room1, space_name: "חדר 1", shared_activity_id: shared2, logistics: {}, groups: [{ group_id: g.ash, group_name: "ash" }], items: { [g.ash]: items2.ash } },
  ];
  const exec = await db.ActivityDayExecution.create({ execution_key: uuid(), template_id: "t", template_name: "יום", template_version: 1, date: DATE, state: "COMPLETED", stations_json: JSON.stringify(stations) });
  // Mirror starts in sync, as after C1.
  for (const r of s.tables.GroupScheduleItem) s.mirror[r.id] = { start: { dateTime: `${r.date}T${r.start_time}:00+02:00` }, end: { dateTime: `${r.date}T${r.end_time}:00+02:00` }, location: s.tables.ActivitySpace.find(x => x.id === r.activity_space_id).name, summary: `${r.activity_name} – g` };
  s.calls.create = 0; s.calls.update = 0;
  return { ...s, sp, g, shared, shared2, exec, unrelated };
}

const user = { email: "admin@test" };
const body = (r) => r.json();
const active = (s, sid) => s.tables.GroupScheduleItem.filter(r => r.shared_activity_id === sid && r.status === "ACTIVE");
const editTarget = (S, over = {}) => ({ title: "סדנה", start_time: "10:00", end_time: "11:00", space_id: S.sp.room6, group_ids: [S.g.ash, S.g.ach, S.g.galil], ...over });
const doEdit = (S, target, extra = {}) => commit(S.base44, S.db, S.exec.id, { action: "commit_edit", station_id: "s1", target, op_id: uuid(), expected_revision: 0, confirmed: true, ...extra }, user, TODAY);
const mirrorConsistent = (S) => {
  for (const r of S.tables.GroupScheduleItem) {
    if (r.status !== "ACTIVE") { assert.equal(S.mirror[r.id], undefined, `stale event for cancelled ${r.id}`); continue; }
    const space = S.tables.ActivitySpace.find(x => x.id === r.activity_space_id).name;
    assert.equal(compareEvent(r, S.mirror[r.id], space).state, "OK", `mirror out of date for ${r.id}`);
  }
};
const calendarEvents = (S) => buildSpaceCalendar({ spaces: S.tables.ActivitySpace, scheduleItems: S.tables.GroupScheduleItem, groups: S.tables.Group, start: DATE, end: DATE }).events.filter(e => e.kind === "GROUP");

test("1. executions are listed with template, version, date, stations, groups and state", () => {
  const ex = { id: "x", template_name: "יום", template_version: 2, date: DATE, state: "COMPLETED", updated_date: "u", stations_json: JSON.stringify([{ station_id: "a", groups: [{ group_name: "א" }] }, { station_id: "b", status: "CANCELLED", groups: [{ group_name: "ב" }] }]) };
  const s = summarizeExecution(ex, TODAY);
  assert.deepEqual([s.template_name, s.template_version, s.station_count, s.active_station_count, s.management_state], ["יום", 2, 2, 1, "ACTIVE"]);
  assert.deepEqual(s.group_names, ["א"]);
  assert.equal(s.capabilities.editable, true);
  assert.equal(summarizeExecution({ ...ex, date: "2030-02-01" }, TODAY).capabilities.editable, false); // past = read-only
  assert.equal(summarizeExecution({ ...ex, state: "INCOMPLETE" }, TODAY).capabilities.editable, false);
});

test("3-11. the spec example: time + room + groups change in place, same shared id, one occupancy, old room released", async () => {
  const S = await seed();
  const before = active(S, S.shared);
  const res = await doEdit(S, editTarget(S));
  const out = await body(res);
  assert.equal(out.outcome, "COMPLETED", JSON.stringify(out));
  const after = active(S, S.shared);
  assert.equal(after.length, 3);
  assert.ok(after.every(r => r.shared_activity_id === S.shared && r.start_time === "10:00" && r.activity_space_id === S.sp.room6));
  const ids = Object.fromEntries(after.map(r => [r.group_id, r.id]));
  assert.equal(ids[S.g.ash], before.find(r => r.group_id === S.g.ash).id); // preserved record
  assert.equal(ids[S.g.ach], before.find(r => r.group_id === S.g.ach).id);
  assert.ok(ids[S.g.galil]); // added
  assert.equal(ids[S.g.arad], undefined);
  assert.equal(S.tables.GroupScheduleItem.find(r => r.group_id === S.g.arad && r.shared_activity_id === S.shared).status, "CANCELLED"); // kept for history
  const ev = calendarEvents(S);
  assert.equal(ev.filter(e => e.space_id === S.sp.mamad).length, 0);
  const inRoom6 = ev.filter(e => e.space_id === S.sp.room6);
  assert.equal(inRoom6.length, 1);
  assert.deepEqual([...inRoom6[0].group_names].sort(), ["אחריי", "אשקלון", "גליל עליון"].sort());
  const journal = JSON.parse(S.tables.ActivityDayExecution[0].stations_json);
  assert.equal(journal.length, 2);
  assert.equal(journal[0].shared_activity_id, S.shared);
  assert.equal(journal[0].original.start_time, "09:00");
  assert.equal(S.tables.ActivityDayExecution[0].revision, 1);
  mirrorConsistent(S);
});

test("12. a Group can join parallel stations (no exclusivity)", async () => {
  const S = await seed();
  // ash is already in s2 (10:00-11:00); moving s1 to 10:00-11:00 keeps ash in both.
  const out = await body(await doEdit(S, editTarget(S, { group_ids: [S.g.ash] })));
  assert.equal(out.outcome, "COMPLETED");
  assert.equal(S.tables.GroupScheduleItem.filter(r => r.group_id === S.g.ash && r.status === "ACTIVE" && r.start_time === "10:00").length, 2);
});

test("13. a confirmed unrelated booking blocks the edit and nothing is written", async () => {
  const S = await seed();
  const snapshot = JSON.stringify(S.tables.GroupScheduleItem);
  const out = await body(await doEdit(S, editTarget(S, { space_id: S.sp.busy })));
  assert.equal(out.outcome, "BLOCKED");
  assert.equal(JSON.stringify(S.tables.GroupScheduleItem), snapshot);
  assert.equal(S.tables.ActivityDayExecution[0].operation_id, undefined);
});

test("13b. another station of the same day in the same room/time is a hard conflict", async () => {
  const S = await seed();
  const out = await body(await doEdit(S, editTarget(S, { space_id: S.sp.room1 })));
  assert.equal(out.outcome, "BLOCKED");
});

test("14-15. a station never conflicts with itself; closed spaces block but capacity is never checked", async () => {
  const S = await seed();
  const sameRoom = await body(await previewEdit(S.base44, S.db, S.exec, { station_id: "s1", target: editTarget(S, { space_id: S.sp.mamad, start_time: "09:30", end_time: "10:30", group_ids: [S.g.ash, S.g.arad, S.g.ach, S.g.galil, S.g.dayuse] }) }, TODAY));
  assert.deepEqual(sameRoom.blockers, []);
  const closed = await body(await previewEdit(S.base44, S.db, S.exec, { station_id: "s1", target: editTarget(S, { space_id: S.sp.closed }) }, TODAY));
  assert.ok(closed.blockers.length > 0);
});

test("5. eligibility of ADDED groups is revalidated on the backend; DAY_USE is eligible", async () => {
  const S = await seed();
  const bad = await body(await previewEdit(S.base44, S.db, S.exec, { station_id: "s1", target: editTarget(S, { group_ids: [S.g.ash, S.g.gone] }) }, TODAY));
  assert.ok(bad.blockers.some(b => b.includes("לא באתר")));
  const day = await body(await previewEdit(S.base44, S.db, S.exec, { station_id: "s1", target: editTarget(S, { group_ids: [S.g.dayuse] }) }, TODAY));
  assert.deepEqual(day.blockers, []);
});

test("5b. existing participants are preserved even if their dates changed later (no silent removal)", async () => {
  const S = await seed();
  S.tables.Group.find(x => x.id === S.g.arad).departure_date = "2030-03-09"; // no longer present on DATE
  const out = await body(await doEdit(S, editTarget(S, { group_ids: [S.g.ash, S.g.arad, S.g.ach] })));
  assert.equal(out.outcome, "COMPLETED");
  assert.equal(active(S, S.shared).length, 3);
});

test("16. double-click / retry with the same op_id never duplicates", async () => {
  const S = await seed();
  const op_id = uuid();
  const a = await body(await doEdit(S, editTarget(S), { op_id }));
  const b = await body(await doEdit(S, editTarget(S), { op_id }));
  assert.equal(a.outcome, "COMPLETED");
  assert.equal(b.replay, true);
  assert.equal(active(S, S.shared).length, 3);
  assert.equal(S.calls.create, 1);
});

test("16b. two simultaneous requests: the lease lets only one run", async () => {
  const S = await seed();
  const op_id = uuid();
  const [a, b] = await Promise.all([doEdit(S, editTarget(S), { op_id }), doEdit(S, editTarget(S), { op_id })].map(p => p.then(body)));
  // Either the second request hit the lease (BUSY) or ran after the first and was replayed; never two writers.
  assert.ok([a.outcome, b.outcome].includes("COMPLETED"));
  assert.ok([a, b].every(r => r.outcome === "COMPLETED" || r.outcome === "BUSY"));
  assert.equal(active(S, S.shared).length, 3);
  assert.equal(S.tables.GroupScheduleItem.filter(r => r.group_id === S.g.galil && r.shared_activity_id === S.shared).length, 1);
});

test("17. a concurrent edit from another admin is rejected as STALE, not overwritten", async () => {
  const S = await seed();
  const first = await body(await doEdit(S, editTarget(S)));
  assert.equal(first.outcome, "COMPLETED");
  const second = await body(await doEdit(S, editTarget(S, { start_time: "12:00", end_time: "13:00" }))); // still holds revision 0
  assert.equal(second.outcome, "STALE");
  assert.ok(active(S, S.shared).every(r => r.start_time === "10:00"));
  assert.equal(startOperationQuery("x", 0).$or.length, 2);
});

test("18. an interrupted edit is detected, blocks new edits, and resumes forward without duplicates", async () => {
  const S = await seed();
  S.failOn.create = 0; // updates of kept groups succeed, the create for the new group dies
  const out = await body(await doEdit(S, editTarget(S)));
  assert.equal(out.outcome, "PARTIAL");
  const ex = S.tables.ActivityDayExecution[0];
  assert.equal(ex.management_state, "NEEDS_RECOVERY");
  const pending = JSON.parse(ex.operation_json);
  const other = await body(await doEdit(S, editTarget(S), { expected_revision: 1 }));
  assert.equal(other.outcome, "OPERATION_PENDING");
  S.failOn.create = Infinity;
  const done = await body(await resume(S.base44, S.db, S.exec.id, { op_id: pending.op_id }, user, TODAY));
  assert.equal(done.outcome, "COMPLETED", JSON.stringify(done));
  assert.equal(active(S, S.shared).length, 3);
  assert.equal(S.tables.ActivityDayExecution[0].management_state, "ACTIVE");
  mirrorConsistent(S);
});

test("18b. an interrupted edit can be reverted to the previous station state", async () => {
  const S = await seed();
  S.failOn.create = 0;
  await doEdit(S, editTarget(S));
  S.failOn.create = Infinity;
  const pending = JSON.parse(S.tables.ActivityDayExecution[0].operation_json);
  const done = await body(await resume(S.base44, S.db, S.exec.id, { op_id: pending.op_id, direction: "revert" }, user, TODAY));
  assert.equal(done.outcome, "COMPLETED", JSON.stringify(done));
  const rows = active(S, S.shared);
  assert.deepEqual(rows.map(r => r.group_id).sort(), [S.g.ash, S.g.arad, S.g.ach].sort());
  assert.ok(rows.every(r => r.start_time === "09:00" && r.activity_space_id === S.sp.mamad));
  mirrorConsistent(S);
});

test("19. cancelling one station releases only its room and keeps provenance", async () => {
  const S = await seed();
  const prev = await body(await previewCancel(S.db, S.exec, { station_id: "s1" }, TODAY));
  assert.equal(prev.total_items, 3);
  const out = await body(await commit(S.base44, S.db, S.exec.id, { action: "cancel_station", station_id: "s1", op_id: uuid(), expected_revision: 0, confirmed: true }, user, TODAY));
  assert.equal(out.outcome, "COMPLETED");
  assert.equal(active(S, S.shared).length, 0);
  assert.equal(active(S, S.shared2).length, 1);
  const j = JSON.parse(S.tables.ActivityDayExecution[0].stations_json);
  assert.equal(j[0].status, "CANCELLED");
  assert.equal(Object.keys(j[0].items).length, 3);
  assert.equal(calendarEvents(S).filter(e => e.space_id === S.sp.mamad).length, 0);
  const again = await body(await commit(S.base44, S.db, S.exec.id, { action: "cancel_station", station_id: "s1", op_id: uuid(), expected_revision: 1, confirmed: true }, user, TODAY));
  assert.equal(again.outcome, "INVALID"); // repeated cancellation has no side effects
  mirrorConsistent(S);
});

test("20-21. cancelling the whole day (with an interruption) releases all its rooms and nothing else", async () => {
  const S = await seed();
  const unrelatedBefore = JSON.stringify(S.tables.GroupScheduleItem.find(r => r.id === S.unrelated.id));
  S.failOn.update = 2; // dies inside station 1
  const out = await body(await commit(S.base44, S.db, S.exec.id, { action: "cancel_day", op_id: uuid(), expected_revision: 0, confirmed: true }, user, TODAY));
  assert.equal(out.outcome, "PARTIAL");
  S.failOn.update = Infinity;
  const pending = JSON.parse(S.tables.ActivityDayExecution[0].operation_json);
  const done = await body(await resume(S.base44, S.db, S.exec.id, { op_id: pending.op_id }, user, TODAY));
  assert.equal(done.outcome, "COMPLETED");
  assert.equal(active(S, S.shared).length + active(S, S.shared2).length, 0);
  assert.equal(S.tables.ActivityDayExecution[0].management_state, "CANCELLED");
  assert.equal(JSON.stringify(S.tables.GroupScheduleItem.find(r => r.id === S.unrelated.id)), unrelatedBefore);
  assert.equal(calendarEvents(S).length, 1); // only the unrelated activity remains
  const replay = await body(await commit(S.base44, S.db, S.exec.id, { action: "cancel_day", op_id: pending.op_id, expected_revision: 1, confirmed: true }, user, TODAY));
  assert.equal(replay.replay, true);
  mirrorConsistent(S);
});

test("past days are read-only; confirmation is mandatory", async () => {
  const S = await seed();
  const past = await body(await commit(S.base44, S.db, S.exec.id, { action: "commit_edit", station_id: "s1", target: editTarget(S), op_id: uuid(), expected_revision: 0, confirmed: true }, user, "2030-04-01"));
  assert.equal(past.outcome, "READ_ONLY");
  const unconfirmed = await body(await doEdit(S, editTarget(S), { confirmed: false }));
  assert.equal(unconfirmed.outcome, "NOT_CONFIRMED");
});

test("an item unlinked from the shared activity elsewhere blocks editing (no duplicate would be created)", async () => {
  const S = await seed();
  const row = S.tables.GroupScheduleItem.find(r => r.group_id === S.g.arad && r.shared_activity_id === S.shared);
  row.shared_activity_id = null;
  const out = await body(await doEdit(S, editTarget(S)));
  assert.equal(out.outcome, "BLOCKED");
  const detail = await presentExecution(S.db, S.tables.ActivityDayExecution[0], TODAY);
  assert.equal(detail.stations[0].detached, 1);
});

test("pure helpers: target validation and in-place plan", () => {
  assert.ok(normalizeEditTarget({ title: "x", start_time: "10:00", end_time: "09:00", space_id: "a".repeat(24), group_ids: ["b".repeat(24)] }).errors.length);
  assert.ok(normalizeEditTarget({ title: "x", start_time: "09:00", end_time: "10:00", space_id: "a".repeat(24), group_ids: [] }).errors.length);
  const st = { shared_activity_id: "S", start_time: "09:00", end_time: "10:00", space_id: "r", items: {} };
  const live = stationLiveState(st, [
    { id: "1", group_id: "A", shared_activity_id: "S", status: "ACTIVE", start_time: "09:00", end_time: "10:00", activity_space_id: "r", created_date: "1" },
    { id: "2", group_id: "A", shared_activity_id: "S", status: "ACTIVE", start_time: "09:00", end_time: "10:00", activity_space_id: "r", created_date: "2" },
  ]);
  assert.equal(live.duplicates, 1);
  const plan = planStationApply(live, { group_ids: ["A"] }, { start_time: "11:00" });
  assert.deepEqual(plan, { updates: [{ id: "1", patch: { start_time: "11:00" } }], creates: [], cancels: ["2"] });
});

test("24. calendar evidence comparison", () => {
  const item = { date: DATE, start_time: "10:00", end_time: "11:00", activity_name: "יום — סדנה" };
  const ev = { start: { dateTime: `${DATE}T10:00:00+02:00` }, end: { dateTime: `${DATE}T11:00:00+02:00` }, location: "חדר 6", summary: "יום — סדנה – אשקלון" };
  assert.equal(compareEvent(item, ev, "חדר 6").state, "OK");
  assert.equal(compareEvent({ ...item, start_time: "09:00" }, ev, "חדר 6").state, "MISMATCH");
  assert.equal(compareEvent(item, ev, "ממ״ד 1").state, "MISMATCH");
  assert.equal(compareEvent(item, null, "x").state, "MISSING_IN_GOOGLE");
  assert.equal(cancelledItemState(true).state, "STALE_EVENT");
  assert.equal(cancelledItemState(false).state, "REMOVED");
});