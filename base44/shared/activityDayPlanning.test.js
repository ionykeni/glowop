import test from "node:test";
import assert from "node:assert/strict";
import { groupDayPresence, stationGroupCheck, evaluateStationSpace, worstStatus, isSelectablePresence, uniqueGroupsSummary } from "./activityDayPlanning.js";

const mp = { id: "g1", stay_mode: "MULTI_PERIOD", group_type: "LODGING", arrival_date: "2026-11-08", departure_date: "2026-11-18" };
const periods = [
  { group_id: "g1", start_date: "2026-11-08", end_date: "2026-11-10", arrival_time: null, departure_time: null, status: "ACTIVE" },
  { group_id: "g1", start_date: "2026-11-15", end_date: "2026-11-18", arrival_time: "14:00", departure_time: null, status: "ACTIVE" },
];
const presentOn = (g, p, d) => isSelectablePresence(groupDayPresence(g, p, d));

test("MULTI_PERIOD: eligible on 8, 10, 15, 18 (inclusive boundaries), not on 12", () => {
  for (const d of ["2026-11-08", "2026-11-10", "2026-11-15", "2026-11-18"]) assert.equal(presentOn(mp, periods, d), true, d);
  assert.equal(groupDayPresence(mp, periods, "2026-11-12").state, "NOT_PRESENT");
});

test("missing arrival/departure clock times never exclude a date-eligible group", () => {
  const cont = { id: "c", stay_mode: "CONTINUOUS", group_type: "LODGING", arrival_date: "2026-11-01", departure_date: "2026-11-04" };
  for (const d of ["2026-11-01", "2026-11-02", "2026-11-04"]) assert.equal(presentOn(cont, [], d), true, d);
  assert.equal(presentOn(cont, [], "2026-11-05"), false);
  assert.equal(stationGroupCheck(groupDayPresence(cont, [], "2026-11-04")).ok, true);
});

test("cancelled periods ignored; envelope never bridges a gap", () => {
  const p = [...periods, { group_id: "g1", start_date: "2026-11-11", end_date: "2026-11-13", status: "CANCELLED" }];
  assert.equal(groupDayPresence(mp, p, "2026-11-12").state, "NOT_PRESENT");
});

test("DAY_USE present only on its visit date; any group type works", () => {
  const du = { id: "d", group_type: "DAY_USE", arrival_date: "2026-11-11" };
  assert.equal(presentOn(du, [], "2026-11-11"), true);
  assert.equal(presentOn(du, [], "2026-11-12"), false);
  const other = { id: "o", group_type: "SOMETHING_ELSE", arrival_date: "2026-11-10", departure_date: "2026-11-12" };
  assert.equal(presentOn(other, [], "2026-11-11"), true);
});

test("genuinely missing/contradictory dates are unverifiable, not invented", () => {
  assert.equal(groupDayPresence(mp, [], "2026-11-12").reason, "NO_STAY_PERIODS");
  const overlapping = [periods[0], { ...periods[0], start_date: "2026-11-09", end_date: "2026-11-11" }];
  assert.equal(groupDayPresence(mp, overlapping, "2026-11-09").reason, "INVALID_STAY_PERIODS");
  const bad = { id: "c", group_type: "LODGING", arrival_date: "2026-11-05", departure_date: "2026-11-03" };
  assert.equal(groupDayPresence(bad, [], "2026-11-04").reason, "CONTRADICTORY_DATES");
  const noDep = { id: "c", group_type: "LODGING", arrival_date: "2026-11-05" };
  assert.equal(presentOn(noDep, [], "2026-11-05"), true);
  assert.equal(presentOn(noDep, [], "2026-11-06"), false);
});

test("headcount summary counts each group once, unknown stays unknown", () => {
  const stations = [1, 2, 3, 4].map(i => ({ groups: [{ group_id: "a" }, ...(i === 1 ? [{ group_id: "b" }] : [])] }));
  const s = uniqueGroupsSummary(stations, { a: { participant_count: 70 }, b: { participant_count: null } });
  assert.deepEqual(s, { group_count: 2, registered_participants: 70, unknown_count: 1 });
});

const space = { id: "s1", name: "ממ״ד 1", capacity: 5, is_bookable: true, working_status: "WORKING" };
const baseCtx = (extra = {}) => ({ date: "2026-11-09", spacesById: { s1: space }, blocks: [], groupItems: [], standalone: [], standaloneSpaceIdsByReservation: {}, pendingRequests: [], stations: [], ...extra });
const st = (id, s, e, extra = {}) => ({ station_id: id, title: id, start_time: s, end_time: e, space_id: "s1", groups: [], ...extra });

test("two distinct stations in the same room/time conflict; parallel rooms and back-to-back are fine", () => {
  const a = st("a", "09:00", "11:00"), b = st("b", "10:00", "12:00"), c = st("c", "09:00", "11:00", { space_id: "s2" });
  const ctx = baseCtx({ stations: [a, b, c], spacesById: { s1: space, s2: { ...space, id: "s2" } } });
  assert.equal(worstStatus(evaluateStationSpace(a, ctx)), "BOOKED");
  assert.equal(worstStatus(evaluateStationSpace(c, ctx)), "AVAILABLE");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ stations: [a, st("d", "11:00", "12:00")] }))), "AVAILABLE");
});

test("3+ groups in one station, same group in parallel stations, small capacity: no conflict", () => {
  const groups = [{ group_id: "x" }, { group_id: "y" }, { group_id: "z" }];
  const a = st("a", "09:00", "10:00", { groups });
  const b = st("b", "09:00", "10:00", { space_id: "s2", groups: [{ group_id: "x" }] });
  const ctx = baseCtx({ stations: [a, b], spacesById: { s1: space, s2: { ...space, id: "s2", capacity: null } } });
  assert.equal(worstStatus(evaluateStationSpace(a, ctx)), "AVAILABLE");
  assert.equal(worstStatus(evaluateStationSpace(b, ctx)), "AVAILABLE");
});

test("confirmed reservations, pending requests (non-blocking), blocks and disabled spaces", () => {
  const a = st("a", "09:00", "11:00");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ groupItems: [{ activity_space_id: "s1", status: "ACTIVE", start_time: "10:30", end_time: "12:00" }] }))), "BOOKED");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ standalone: [{ id: "r", status: "ACTIVE", start_time: "08:00", end_time: "09:30" }], standaloneSpaceIdsByReservation: { r: ["s1"] } }))), "BOOKED");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ pendingRequests: [{ space_id: "s1", status: "PENDING", start_time: "10:00", end_time: "10:30" }] }))), "PENDING");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ blocks: [{ activity_space_id: "s1", status: "ACTIVE", start_date: "2026-11-01", start_time: "08:00", is_open_ended: true }] }))), "UNAVAILABLE");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ spacesById: { s1: { ...space, working_status: "CLOSED" } } }))), "UNAVAILABLE");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ spacesById: { s1: { ...space, is_bookable: false } } }))), "UNAVAILABLE");
});