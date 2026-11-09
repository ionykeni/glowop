import test from "node:test";
import assert from "node:assert/strict";
import { busyIntervals, statusAt, layoutLanes, freeAgainAt, blockRangeOnDay, toMin, eventEnd, weekDates, spaceCode } from "./spaceCalendarView.js";

test("pending requests never make a space busy; blocks and confirmed do", () => {
  const evs = [{ status: "CONFIRMED", start_time: "10:00", end_time: "11:00" }, { status: "PENDING", start_time: "12:00", end_time: "13:00" }, { status: "CONFIRMED", start_time: "10:30", end_time: "12:00" }];
  const blocks = [{ start_date: "2026-11-09", start_time: "16:00", end_date: "2026-11-09", end_time: "18:00", is_open_ended: false }];
  const iv = busyIntervals(evs, blocks, "2026-11-09");
  assert.deepEqual(iv, [[600, 720], [960, 1080]]);
  assert.equal(statusAt({ available: true }, iv, toMin("12:30")).kind, "free");
  assert.equal(statusAt({ available: true }, iv, toMin("12:30")).label, "פנוי עד 16:00");
  assert.equal(statusAt({ available: true }, iv, toMin("10:15")).label, "תפוס עד 12:00");
  assert.equal(freeAgainAt(iv, toMin("10:59")), 720);
  assert.equal(statusAt({ available: false, unavailable_label: "סגור" }, [], 600).kind, "closed");
});

test("overlapping activities are stacked in separate lanes", () => {
  const { placed, lanes } = layoutLanes([{ id: 1, start_time: "10:00", end_time: "12:00" }, { id: 2, start_time: "11:00", end_time: "13:00" }, { id: 3, start_time: "12:00", end_time: "14:00" }]);
  assert.equal(lanes, 2);
  assert.deepEqual(placed.map(p => p.lane), [0, 1, 0]);
});

test("multi-day blocks clip per day; midnight end; Sunday week; short codes", () => {
  const b = { start_date: "2026-11-08", start_time: "20:00", end_date: "2026-11-10", end_time: "09:00", is_open_ended: false };
  assert.deepEqual(blockRangeOnDay(b, "2026-11-08"), [1200, 1440]);
  assert.deepEqual(blockRangeOnDay(b, "2026-11-09"), [0, 1440]);
  assert.deepEqual(blockRangeOnDay(b, "2026-11-10"), [0, 540]);
  assert.equal(blockRangeOnDay(b, "2026-11-11"), null);
  assert.equal(eventEnd({ start_time: "22:00", end_time: "00:00" }), 1440);
  assert.deepEqual([weekDates("2026-11-11")[0], weekDates("2026-11-11")[6]], ["2026-11-08", "2026-11-14"]);
  assert.equal(spaceCode("בולדר 1 — שכונה 1"), "ב1");
  assert.equal(spaceCode("חדר אוכל"), "חא");
});