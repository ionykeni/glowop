import test from "node:test";
import assert from "node:assert/strict";
import { groupDayPresence, stationGroupCheck, evaluateStationSpace, participantIssue, worstStatus, isSelectablePresence } from "./activityDayPlanning.js";

const mp = { id: "g1", stay_mode: "MULTI_PERIOD", group_type: "LODGING", arrival_date: "2026-11-08", departure_date: "2026-11-18" };
const periods = [
  { group_id: "g1", start_date: "2026-11-08", end_date: "2026-11-10", arrival_time: "10:00", departure_time: "12:00", status: "ACTIVE" },
  { group_id: "g1", start_date: "2026-11-15", end_date: "2026-11-18", arrival_time: "14:00", departure_time: null, status: "ACTIVE" },
];

test("MULTI_PERIOD gap excludes group (Nov 12 between 8–10 and 15–18)", () => {
  assert.equal(groupDayPresence(mp, periods, "2026-11-12").state, "NOT_PRESENT");
  assert.equal(groupDayPresence(mp, periods, "2026-11-09").state, "FULL_DAY");
  assert.equal(groupDayPresence(mp, periods, "2026-11-16").state, "FULL_DAY");
});

test("cancelled periods are ignored and envelope is never used as continuous", () => {
  const p = [...periods, { group_id: "g1", start_date: "2026-11-11", end_date: "2026-11-13", status: "CANCELLED", arrival_time: "09:00", departure_time: "18:00" }];
  assert.equal(groupDayPresence(mp, p, "2026-11-12").state, "NOT_PRESENT");
});

test("arrival/departure time boundaries are respected per station", () => {
  const arr = groupDayPresence(mp, periods, "2026-11-08");
  assert.equal(arr.state, "PARTIAL");
  assert.equal(stationGroupCheck(arr, "09:00", "11:00").code, "OUTSIDE_STAY_WINDOW");
  assert.equal(stationGroupCheck(arr, "10:00", "12:00").ok, true);
  const dep = groupDayPresence(mp, periods, "2026-11-10");
  assert.equal(stationGroupCheck(dep, "11:00", "13:00").code, "OUTSIDE_STAY_WINDOW");
  assert.equal(stationGroupCheck(dep, "09:00", "12:00").ok, true);
});

test("missing boundary time or stay data is unverifiable, not valid", () => {
  const dep = groupDayPresence(mp, periods, "2026-11-18");
  assert.equal(dep.state, "UNVERIFIABLE");
  assert.equal(isSelectablePresence(dep), false);
  assert.equal(stationGroupCheck(dep, "09:00", "10:00").ok, false);
  assert.equal(groupDayPresence(mp, [], "2026-11-12").reason, "NO_STAY_PERIODS");
  assert.equal(groupDayPresence(mp, [], "2026-12-01").state, "NOT_PRESENT");
  const overlapping = [periods[0], { ...periods[0], start_date: "2026-11-09", end_date: "2026-11-11" }];
  assert.equal(groupDayPresence(mp, overlapping, "2026-11-09").reason, "INVALID_STAY_PERIODS");
  const cont = { id: "c", stay_mode: "CONTINUOUS", group_type: "LODGING", arrival_date: "2026-11-05", departure_date: "2026-11-03" };
  assert.equal(groupDayPresence(cont, [], "2026-11-04").reason, "CONTRADICTORY_DATES");
  const noDep = { id: "c", stay_mode: "CONTINUOUS", group_type: "LODGING", arrival_date: "2026-11-05", arrival_time: "10:00" };
  assert.equal(groupDayPresence(noDep, [], "2026-11-05").reason, "MISSING_DEPARTURE_DATE");
  assert.equal(groupDayPresence(noDep, [], "2026-11-06").state, "NOT_PRESENT");
});

test("continuous groups use Group dates and times; historical cohorts excluded", () => {
  const cont = { id: "c", stay_mode: "CONTINUOUS", group_type: "LODGING", arrival_date: "2026-11-01", departure_date: "2026-11-04", arrival_time: "12:00", departure_time: "10:00" };
  assert.equal(groupDayPresence(cont, [], "2026-11-02").state, "FULL_DAY");
  assert.equal(groupDayPresence(cont, [], "2026-11-10").state, "NOT_PRESENT");
  const d = groupDayPresence(cont, [], "2026-11-04");
  assert.equal(stationGroupCheck(d, "09:00", "10:00").ok, true);
  assert.equal(stationGroupCheck(d, "09:00", "11:00").ok, false);
});

const space = { id: "s1", name: "ממ״ד 1", capacity: 40, is_bookable: true, working_status: "WORKING" };
const baseCtx = (extra = {}) => ({ date: "2026-11-09", spacesById: { s1: space }, blocks: [], groupItems: [], standalone: [], standaloneSpaceIdsByReservation: {}, pendingRequests: [], stations: [], ...extra });
const st = (id, s, e, extra = {}) => ({ station_id: id, title: id, start_time: s, end_time: e, space_id: "s1", total_participants: 30, ...extra });

test("two different stations competing for the same space/time conflict; parallel in different spaces is fine", () => {
  const a = st("a", "09:00", "11:00"), b = st("b", "10:00", "12:00"), c = st("c", "09:00", "11:00", { space_id: "s2" });
  const ctx = baseCtx({ stations: [a, b, c], spacesById: { s1: space, s2: { ...space, id: "s2" } } });
  assert.equal(worstStatus(evaluateStationSpace(a, ctx)), "BOOKED");
  assert.equal(worstStatus(evaluateStationSpace(c, ctx)), "AVAILABLE");
  const back2back = st("d", "11:00", "12:00");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ stations: [a, back2back] }))), "AVAILABLE");
});

test("many groups in one station are one physical use (no self-conflict)", () => {
  const a = st("a", "09:00", "11:00", { groups: [{ group_id: "x" }, { group_id: "y" }] });
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ stations: [a] }))), "AVAILABLE");
});

test("confirmed reservations, pending requests, blocks and disabled spaces", () => {
  const a = st("a", "09:00", "11:00");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ groupItems: [{ activity_space_id: "s1", status: "ACTIVE", start_time: "10:30", end_time: "12:00" }] }))), "BOOKED");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ standalone: [{ id: "r", status: "ACTIVE", start_time: "08:00", end_time: "09:30" }], standaloneSpaceIdsByReservation: { r: ["s1"] } }))), "BOOKED");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ pendingRequests: [{ space_id: "s1", status: "PENDING", start_time: "10:00", end_time: "10:30" }] }))), "PENDING");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ blocks: [{ activity_space_id: "s1", status: "ACTIVE", start_date: "2026-11-01", start_time: "08:00", is_open_ended: true }] }))), "UNAVAILABLE");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ spacesById: { s1: { ...space, working_status: "CLOSED" } } }))), "UNAVAILABLE");
  assert.equal(worstStatus(evaluateStationSpace(a, baseCtx({ spacesById: { s1: { ...space, is_bookable: false } } }))), "UNAVAILABLE");
});

test("capacity uses real capacity; unknown capacity is not unlimited", () => {
  assert.equal(worstStatus(evaluateStationSpace(st("a", "09:00", "11:00", { total_participants: 41 }), baseCtx())), "OVER_CAPACITY");
  assert.equal(worstStatus(evaluateStationSpace(st("a", "09:00", "11:00", { total_participants: 40 }), baseCtx())), "AVAILABLE");
  assert.equal(worstStatus(evaluateStationSpace(st("a", "09:00", "11:00"), baseCtx({ spacesById: { s1: { ...space, capacity: null } } }))), "UNVERIFIABLE");
});

test("participant quantities: missing and above-group are flagged", () => {
  assert.equal(participantIssue(null, { participant_count: 30 }).code, "MISSING_PARTICIPANTS");
  assert.equal(participantIssue(35, { participant_count: 30 }).code, "PARTICIPANTS_ABOVE_GROUP");
  assert.equal(participantIssue(20, { participant_count: 30 }), null);
});