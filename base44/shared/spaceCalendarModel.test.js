import test from "node:test";
import assert from "node:assert/strict";
import { buildSpaceCalendar } from "./spaceCalendarModel.js";

const S = (id, extra = {}) => ({ id, name: `בונקר ${id}`, code: `bunker_${id}`, space_type: "BUNKER", is_bookable: true, working_status: "WORKING", ...extra });
const G = (id, extra = {}) => ({ id, group_name: `קבוצה ${id}`, group_type: "LODGING", status: "CONFIRMED", ...extra });
const item = (id, extra) => ({ id, status: "ACTIVE", activity_space_id: "A", date: "2026-11-09", start_time: "10:00", end_time: "11:30", activity_name: "סדנה", group_id: "G1", pax: 20, ...extra });
const base = { spaces: [S("A"), S("B"), S("C", { working_status: "CLOSED" })], groups: [G("G1"), G("G2"), G("M1")], mechinaGroupIds: ["M1"], start: "2026-11-08", end: "2026-11-14" };

test("shared activity across groups is shown once with all group names", () => {
  const m = buildSpaceCalendar({ ...base, scheduleItems: [item("i1", { shared_activity_id: "sh" }), item("i2", { group_id: "G2", shared_activity_id: "sh" })] });
  assert.equal(m.events.length, 1);
  assert.deepEqual(m.events[0].group_names, ["קבוצה G1", "קבוצה G2"]);
  assert.equal(m.events[0].pax, 40);
});

test("approved Mechina request is not double counted; pending request is PENDING", () => {
  const m = buildSpaceCalendar({ ...base,
    scheduleItems: [item("i9", { group_id: "M1" })],
    requests: [
      { id: "r1", status: "APPROVED", approved_schedule_item_id: "i9", space_id: "A", date: "2026-11-09", start_time: "10:00", end_time: "11:30", mechina_group_id: "M1", activity_title: "x" },
      { id: "r2", status: "PENDING", space_id: "B", date: "2026-11-09", start_time: "14:00", end_time: "15:00", mechina_group_id: "M1", activity_title: "בקשה", requested_by_email: "a@b.c", admin_notes: "secret" },
    ] });
  assert.equal(m.events.length, 2);
  assert.equal(m.events.find(e => e.space_id === "A").group_type, "MECHINA");
  const pending = m.events.find(e => e.status === "PENDING");
  assert.equal(pending.space_id, "B");
  assert.equal(JSON.stringify(pending).includes("secret") || JSON.stringify(pending).includes("a@b.c"), false, "no private fields");
});

test("standalone activity appears once per assigned space; closed spaces flagged", () => {
  const m = buildSpaceCalendar({ ...base,
    standalone: [{ id: "s1", status: "ACTIVE", title: "הרצאה", event_date: "2026-11-10", start_time: "09:00", end_time: "10:00", organizer_phone: "050" }],
    assignments: [{ reservation_id: "s1", activity_space_id: "A" }, { reservation_id: "s1", activity_space_id: "B" }, { reservation_id: "s1", activity_space_id: "A" }] });
  assert.equal(m.events.length, 2);
  assert.ok(m.events.every(e => e.group_type === "GENERAL" && !("organizer_phone" in e)));
  assert.equal(m.spaces.find(s => s.id === "C").available, false);
  assert.equal(m.spaces.find(s => s.id === "C").unavailable_label, "סגור");
});

test("inactive groups, cancelled items and out-of-range dates are excluded", () => {
  const m = buildSpaceCalendar({ ...base, groups: [...base.groups, G("X", { operationally_active: false })],
    scheduleItems: [item("a", { group_id: "X" }), item("b", { status: "CANCELLED" }), item("c", { date: "2026-12-01" })] });
  assert.equal(m.events.length, 0);
});

test("only active blocks overlapping the range are returned, without notes", () => {
  const m = buildSpaceCalendar({ ...base, blocks: [
    { id: "b1", status: "ACTIVE", activity_space_id: "A", start_date: "2026-11-01", is_open_ended: true, reason_type: "REPAIR", reason_notes: "פרטי" },
    { id: "b2", status: "CANCELLED", activity_space_id: "A", start_date: "2026-11-09", end_date: "2026-11-09" },
    { id: "b3", status: "ACTIVE", activity_space_id: "B", start_date: "2026-10-01", end_date: "2026-10-02" },
  ] });
  assert.deepEqual(m.blocks.map(b => b.id), ["b1"]);
  assert.equal(m.blocks[0].reason_label, "תיקון");
  assert.equal("reason_notes" in m.blocks[0], false);
});