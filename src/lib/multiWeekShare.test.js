// Run: node --test src/lib/multiWeekShare.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { periodRange, waPhone, waLink, multiWeekMessage, missingWeekLabels } from "./multiWeekShare.js";

const START = "2026-11-15";

test("period selector ranges", () => {
  assert.deepEqual(periodRange({ mode: "1", startWeek: START }).range, { start: START, end: "2026-11-21" });
  assert.deepEqual(periodRange({ mode: "2", startWeek: START }).range, { start: START, end: "2026-11-28" });
  assert.deepEqual(periodRange({ mode: "3", startWeek: START }).range, { start: START, end: "2026-12-05" });
  assert.deepEqual(periodRange({ mode: "4", startWeek: START }).range, { start: START, end: "2026-12-12" });
  assert.deepEqual(periodRange({ mode: "custom", customStart: "2026-11-18", customEnd: "2026-12-02" }).range, { start: "2026-11-18", end: "2026-12-02" });
  assert.ok(periodRange({ mode: "custom", customStart: "2026-12-02", customEnd: "2026-11-18" }).error);
  assert.ok(periodRange({ mode: "custom", customStart: "2026-01-01", customEnd: "2026-12-31" }).error);
  assert.ok(periodRange({ mode: "custom", customStart: "", customEnd: "2026-12-31" }).error);
});

test("WhatsApp handoff helpers", () => {
  assert.equal(waPhone("050-123-4567"), "972501234567");
  assert.equal(waPhone("+972 50 123 4567"), "972501234567");
  assert.equal(waPhone("00972501234567"), "972501234567");
  assert.equal(waPhone(""), "");
  assert.equal(waPhone("1234"), "");
  const msg = multiWeekMessage("עובד א", { start: START, end: "2026-12-12" }, ["29/11/2026 – 05/12/2026 (טיוטה)"]);
  assert.match(msg, /15\/11\/2026 – 12\/12\/2026/);
  assert.match(msg, /טרם פורסמו/);
  assert.ok(waLink("050-123-4567", msg).startsWith("https://wa.me/972501234567?text="));
  assert.doesNotMatch(multiWeekMessage("עובד א", { start: START, end: "2026-11-28" }), /טרם פורסמו/);
});

test("unpublished weeks are listed and clipped to the range", () => {
  const report = { unpublished_weeks: [{ week_start: "2026-11-29", week_end: "2026-12-05", status: "DRAFT" }, { week_start: "2026-12-06", week_end: "2026-12-12", status: "MISSING" }] };
  assert.deepEqual(missingWeekLabels(report, { start: START, end: "2026-12-08" }), ["29/11/2026 – 05/12/2026 (טיוטה)", "06/12/2026 – 08/12/2026 (אין סידור)"]);
  assert.deepEqual(missingWeekLabels({ unpublished_weeks: [] }, { start: START, end: "2026-11-21" }), []);
});