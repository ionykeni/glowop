// Run (resolves the "@/" alias):
//   npx esbuild src/lib/multiWeekTeamReport.test.js --bundle --platform=node --format=esm --alias:@=./src --loader:.js=jsx --jsx=automatic --packages=external --outfile=/tmp/mwtr.test.mjs && node --test /tmp/mwtr.test.mjs
// SIMULATED data only — no network, no writes.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMultiWeekTeamReport, periodWeekStarts, periodEnd } from "@/lib/multiWeekTeamReport";
import { addDays } from "@/lib/workScheduleConfig";
import { generateMultiWeekTeamPdfHtml } from "@/components/work-schedule/report/MultiWeekTeamPdfView";
import { generateWeeklySchedulePdfHtml } from "@/components/work-schedule/WeeklySchedulePdfView";

const START = "2026-11-15";
const STATUS = { "2026-11-15": "PUBLISHED", "2026-11-22": "PUBLISHED", "2026-11-29": "DRAFT", "2026-12-06": null };
let n = 0;
const sh = (sid, o) => ({ id: `x${n++}`, work_schedule_id: sid, status: "PLANNED", row_type: "OPERATIONS_MORNING", row_label: "תפעול בוקר", start_time: "07:00", end_time: "15:00", ...o });

function week(weekStart) {
  const status = STATUS[weekStart];
  if (!status) return { weekStart, schedule: null, shifts: [] };
  const sid = "s" + weekStart, shifts = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    shifts.push(sh(sid, { date, worker_id: "w1", worker_name: "עומר" }));
    if (i % 2 === 0) shifts.push(sh(sid, { date, worker_id: "w2", worker_name: "נדב", row_type: "OPERATIONS_EVENING", row_label: "תפעול ערב", start_time: "16:00", end_time: "23:00" }));
    if (i % 3 === 0) shifts.push(sh(sid, { date, worker_id: "w2", worker_name: "נדב", row_type: "NIGHT_ON_CALL", row_label: "כונן לילה", start_time: "", end_time: "" }));
  }
  // Overnight shift on Saturday stays in its own week
  shifts.push(sh(sid, { date: addDays(weekStart, 6), worker_id: "w3", worker_name: "דנה", row_type: "MAINTENANCE", row_label: "תחזוקה", start_time: "22:00", end_time: "06:00" }));
  shifts.push(sh(sid, { date: addDays(weekStart, 1), row_type: "HOUSEKEEPING_MORNING", worker_count: 3 }));
  shifts.push(sh(sid, { date: addDays(weekStart, 2), worker_id: "w1", worker_name: "עומר", status: "CANCELLED" }));
  return { weekStart, schedule: { id: sid, week_start_date: weekStart, status }, shifts };
}
const report = (count) => buildMultiWeekTeamReport(periodWeekStarts(START, count).map(week));

test("2, 3 and 4 weeks: range, statuses, worker → week → day order", () => {
  for (const count of [2, 3, 4]) {
    const r = report(count);
    assert.equal(r.start, START);
    assert.equal(r.end, periodEnd(START, count));
    assert.equal(r.statuses.length, count);
    const publishedWeeks = r.statuses.filter((s) => s.status === "PUBLISHED").map((s) => s.weekStart);
    assert.deepEqual(publishedWeeks, ["2026-11-15", "2026-11-22"]);
    assert.deepEqual(r.workers.map((w) => w.name), ["נדב", "עומר", "דנה"], "same order rule as the one-week report");
    for (const w of r.workers) {
      assert.deepEqual(w.weeks.map((wk) => wk.weekStart), publishedWeeks, `${w.name} weeks chronological, drafts excluded`);
      for (const wk of w.weeks) {
        const dates = wk.days.map((d) => d.date);
        assert.deepEqual([...dates].sort(), dates);
        assert.ok(dates.every((d) => d >= wk.weekStart && d <= addDays(wk.weekStart, 6)), "days stay inside their week");
      }
    }
    assert.equal(r.workers.find((w) => w.name === "עומר").totalShifts, 14, "cancelled shifts ignored");
    assert.equal(r.cleaning.length, 2);
  }
  assert.deepEqual(report(3).unpublished.map((s) => s.status), ["DRAFT"]);
  assert.deepEqual(report(4).unpublished.map((s) => s.status), ["DRAFT", "MISSING"]);
  assert.deepEqual(report(2).unpublished, []);
});

test("team PDF: one document, all workers and weeks, Hebrew RTL, warnings, night + overnight", () => {
  const html = generateMultiWeekTeamPdfHtml(report(3));
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /size: A4 portrait/);
  assert.match(html, /15\/11\/2026 – 05\/12\/2026/);
  for (const name of ["עומר", "נדב", "דנה"]) assert.ok(html.includes(`<h2>${name}</h2>`));
  assert.equal((html.match(/class="worker"/g) || []).length, 3);
  assert.equal((html.match(/שבוע 15\/11–21\/11 · /g) || []).length, 5, "status chip + week band per worker (3) + cleaning");
  assert.ok(html.includes("שבוע 29/11–05/12 · טיוטה – לא נכלל"));
  assert.ok(html.includes("שים לב: מסמך חלקי"));
  assert.ok(!html.includes("29/11</small>") && !html.includes("01/12</small>"), "no draft days listed");
  assert.ok(html.includes('<div class="night">כונן לילה</div>'));
  assert.ok(html.includes("תחזוקה · 22:00–06:00"));
  assert.match(html, /\.week \{[^}]*break-inside: avoid/);
  assert.match(html, /tr \{ break-inside: avoid/);
  const full = generateMultiWeekTeamPdfHtml(report(2));
  assert.ok(!full.includes("מסמך חלקי"), "fully published period has no warning");
});

test("one-week print is still the original weekly grid", () => {
  const w = week(START);
  const html = generateWeeklySchedulePdfHtml(w.schedule, w.shifts, START);
  assert.match(html, /<title>סידור עבודה שבועי<\/title>/);
  assert.match(html, /size: A4 landscape/);
  assert.match(html, /schedule-table/);
  assert.ok(!html.includes("לפי עובדים"));
});