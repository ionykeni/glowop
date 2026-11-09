import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeStations, validateTemplate } from "./activityDayTemplate.js";

const codes = (errors) => errors.map(e => e.code);
const station = (extra = {}) => ({ title: "תחנה", start_time: "09:00", end_time: "12:00", ...extra });

test("sanitize keeps order, assigns ids and strips operational identifiers", () => {
  const out = sanitizeStations([
    station({ title: "א", group_id: "g1", shared_activity_id: "s1", split_group_id: "x", calendar_event_id: "c" }),
    station({ title: "ב" }),
  ]);
  assert.deepEqual(out.map(s => s.title), ["א", "ב"]);
  assert.deepEqual(out.map(s => s.display_order), [1, 2]);
  for (const s of out) {
    assert.ok(s.station_id);
    for (const k of ["group_id", "shared_activity_id", "split_group_id", "calendar_event_id"]) assert.equal(k in s, false);
  }
});

test("new version regenerates station ids; duplicate ids are replaced", () => {
  const id = "abcdefgh-1234";
  assert.notEqual(sanitizeStations([{ station_id: id }], { keepIds: false })[0].station_id, id);
  const dup = sanitizeStations([{ station_id: id }, { station_id: id }]);
  assert.equal(dup[0].station_id, id);
  assert.notEqual(dup[1].station_id, id);
});

test("parallel overlapping stations are valid", () => {
  const stations = sanitizeStations([station(), station({ start_time: "10:00", end_time: "11:00" })]);
  assert.deepEqual(validateTemplate({ name: "t", stations }, { forReady: true }), []);
});

test("draft may be incomplete but READY may not", () => {
  const stations = sanitizeStations([{ title: "" }]);
  assert.deepEqual(validateTemplate({ name: "t", stations }), []);
  const ready = codes(validateTemplate({ name: "t", stations }, { forReady: true }));
  assert.ok(ready.includes("TITLE_REQUIRED") && ready.includes("TIME_REQUIRED"));
  assert.ok(codes(validateTemplate({ name: "t", stations: [] }, { forReady: true })).includes("NO_STATIONS"));
});

test("rejects empty name, bad times, end before start, negative chairs, unknown space", () => {
  assert.ok(codes(validateTemplate({ name: " ", stations: [] })).includes("NAME_REQUIRED"));
  const bad = sanitizeStations([
    station({ start_time: "9:00" }),
    station({ start_time: "12:00", end_time: "12:00" }),
    station({ chairs_count: -1 }),
    station({ chairs_count: "2.5" }),
    station({ suggested_space_id: "missing" }),
  ]);
  const errs = codes(validateTemplate({ name: "t", stations: bad }, { spaceIds: new Set(["real"]) }));
  for (const c of ["TIME_INVALID", "END_BEFORE_START", "CHAIRS_INVALID", "SPACE_NOT_FOUND"]) assert.ok(errs.includes(c), c);
  const ok = sanitizeStations([station({ suggested_space_id: "real", chairs_count: "0" })]);
  assert.deepEqual(validateTemplate({ name: "t", stations: ok }, { spaceIds: new Set(["real"]) }), []);
});