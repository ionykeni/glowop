// Run: node --test tests/workScheduleReport.test.js
// PDF tests need /tmp/Alef-Regular.ttf and /tmp/Alef-Bold.ttf (the same fonts the backend function downloads).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { jsPDF as JsPDF } from "jspdf";
import { buildScheduleReport, filterReportToWorker, shiftInterval, localToUtcMs, splitByLocalDay, validateRange, weekStartOf, fmtMinutes } from "../base44/shared/workScheduleReport.js";
import { toVisual } from "../base44/shared/hebrewPdfText.js";
import { buildWorkerPdf, buildTeamPdf } from "../base44/shared/workSchedulePdf.js";

const PUB = { id: "sp", week_start_date: "2026-10-25", status: "PUBLISHED" };
const DRAFT = { id: "sd", week_start_date: "2026-11-01", status: "DRAFT" };
const workers = [{ id: "w1", full_name: "עובד א", default_team: "OPERATIONS" }, { id: "w2", full_name: "עובד ב", default_team: "OPERATIONS" }];
const sh = (o) => ({ id: o.id || Math.random().toString(36).slice(2), status: "PLANNED", work_schedule_id: "sp", worker_id: "w1", row_type: "OPERATIONS_MORNING", row_label: "תפעול בוקר", ...o });
const run = (shifts, start = "2026-10-25", end = "2026-10-31", schedules = [PUB, DRAFT]) => buildScheduleReport({ start, end, shifts, schedules, workers, generatedAt: "2026-11-12T10:00:00.000Z" });
const w = (r, id = "w1") => r.workers.find((x) => x.worker_id === id);

test("timezone conversion uses Asia/Jerusalem", () => {
  assert.equal(new Date(localToUtcMs("2026-07-01", "08:00")).toISOString(), "2026-07-01T05:00:00.000Z"); // IDT +3
  assert.equal(new Date(localToUtcMs("2026-12-01", "08:00")).toISOString(), "2026-12-01T06:00:00.000Z"); // IST +2
});

test("overnight and DST-aware durations", () => {
  assert.equal(shiftInterval({ date: "2026-11-05", start_time: "22:00", end_time: "06:00" }).minutes, 480);
  assert.equal(shiftInterval({ date: "2026-10-24", start_time: "22:00", end_time: "06:00" }).minutes, 540); // DST ends 25/10
  assert.equal(shiftInterval({ date: "2026-03-26", start_time: "22:00", end_time: "06:00" }).minutes, 420); // DST starts 27/03
  assert.equal(shiftInterval({ date: "2026-11-05", start_time: "08:00", end_time: "08:00" }).valid, false);
  assert.equal(shiftInterval({ date: "2026-11-05", start_time: "", end_time: "08:00" }).valid, false);
});

test("day split at local midnight", () => {
  const a = localToUtcMs("2026-11-05", "22:00"), b = localToUtcMs("2026-11-06", "06:00");
  assert.deepEqual(splitByLocalDay(a, b), [{ date: "2026-11-05", minutes: 120 }, { date: "2026-11-06", minutes: 360 }]);
});

test("month boundary: an overnight shift is split between months without double counting", () => {
  const shifts = [sh({ date: "2026-10-31", start_time: "22:00", end_time: "06:00" })];
  const oct = run(shifts, "2026-10-01", "2026-10-31");
  const nov = run(shifts, "2026-11-01", "2026-11-30");
  assert.equal(w(oct).published.planned_minutes, 120);
  assert.equal(w(oct).published.shift_count, 1);
  assert.equal(w(nov).published.planned_minutes, 360);
  assert.equal(w(nov).published.shift_count, 0); // counted on its start date only
  assert.equal(w(nov).items[0].starts_before_period, true);
  assert.equal(w(run(shifts, "2026-10-01", "2026-11-30")).published.planned_minutes, 480);
});

test("year boundary is handled", () => {
  const s = { id: "sy", week_start_date: "2026-12-27", status: "PUBLISHED" };
  const r = run([sh({ date: "2026-12-31", start_time: "20:00", end_time: "04:00", work_schedule_id: "sy" })], "2026-12-27", "2027-01-02", [s]);
  assert.deepEqual(w(r).days.map((d) => [d.date, d.published_minutes]), [["2026-12-31", 240], ["2027-01-01", 240]]);
});

test("overlapping shifts are kept, warned, and counted once", () => {
  const r = run([
    sh({ id: "a", date: "2026-10-26", start_time: "07:00", end_time: "16:00" }),
    sh({ id: "b", date: "2026-10-26", start_time: "08:00", end_time: "16:00", row_type: "HOUSEKEEPING_MANAGER", row_label: "אחראי משק בית" }),
  ]);
  const x = w(r);
  assert.equal(x.items.length, 2);
  assert.equal(x.published.gross_minutes, 17 * 60);
  assert.equal(x.published.planned_minutes, 9 * 60);
  assert.equal(x.published.overlap_minutes, 8 * 60);
  assert.equal(x.published.shift_count, 2);
  assert.equal(r.warnings.filter((wn) => wn.type === "OVERLAP").length, 1);
});

test("on-call is separate from planned hours", () => {
  const r = run([
    sh({ date: "2026-10-26", row_type: "NIGHT_ON_CALL", row_label: "כונן לילה", start_time: null, end_time: null }),
    sh({ date: "2026-10-27", row_type: "NIGHT_ON_CALL", row_label: "כונן לילה", start_time: "22:00", end_time: "07:00" }),
  ]);
  const x = w(r);
  assert.equal(x.published.planned_minutes, 0);
  assert.equal(x.published.shift_count, 0);
  assert.equal(x.published.on_call_count, 2);
  assert.equal(x.published.on_call_minutes, 540);
  assert.equal(r.warnings.length, 0);
});

test("draft and published are separated; unpublished weeks are listed", () => {
  const r = run([
    sh({ date: "2026-10-26", start_time: "07:00", end_time: "16:00" }),
    sh({ date: "2026-11-02", start_time: "07:00", end_time: "16:00", work_schedule_id: "sd" }),
  ], "2026-10-25", "2026-11-14");
  assert.equal(w(r).published.planned_minutes, 540);
  assert.equal(w(r).draft.planned_minutes, 540);
  assert.deepEqual(r.unpublished_weeks.map((x) => [x.week_start, x.status]), [["2026-11-01", "DRAFT"], ["2026-11-08", "MISSING"]]);
  assert.deepEqual(w(r).weeks.map((x) => [x.week_start, x.published_minutes, x.draft_minutes]), [["2026-10-25", 540, 0], ["2026-11-01", 0, 540]]);
});

test("publication changes totals without changing records", () => {
  const shifts = [sh({ date: "2026-11-02", start_time: "07:00", end_time: "16:00", work_schedule_id: "sd" })];
  const before = run(shifts, "2026-11-01", "2026-11-07");
  const after = run(shifts, "2026-11-01", "2026-11-07", [{ ...DRAFT, status: "PUBLISHED" }]);
  assert.equal(w(before).published.planned_minutes, 0);
  assert.equal(w(after).published.planned_minutes, 540);
  assert.equal(shifts[0].work_schedule_id, "sd");
});

test("exclusions and warnings", () => {
  const r = run([
    sh({ date: "2026-10-26", start_time: "07:00", end_time: "16:00", status: "CANCELLED" }),
    sh({ date: "2026-10-26", start_time: "07:00", end_time: "16:00", worker_id: "" }),
    sh({ date: "2026-10-26", start_time: "07:00", end_time: "16:00", work_schedule_id: "nope" }),
    sh({ date: "2026-10-27", start_time: "08:00", end_time: "05:00" }),
    sh({ date: "2026-10-28", start_time: "08:00", end_time: "" }),
    sh({ date: "2026-10-28", start_time: "08:00", end_time: "16:00", worker_id: "ghost", worker_name: "שם ישן" }),
  ]);
  assert.deepEqual(r.excluded, { cancelled: 1, unassigned: 1, missing_schedule: 1, archived_schedule: 0 });
  assert.deepEqual(r.warnings.map((x) => x.type).sort(), ["INVALID_TIMES", "LONG_SHIFT", "MISSING_WORKER"]);
  assert.equal(w(r).published.planned_minutes, 21 * 60); // flagged, not altered
  assert.equal(w(r, "ghost").worker_name, "שם ישן");
});

test("worker filter keeps only that worker", () => {
  const r = filterReportToWorker(run([sh({ date: "2026-10-26", start_time: "07:00", end_time: "16:00" }), sh({ date: "2026-10-26", start_time: "07:00", end_time: "16:00", worker_id: "w2" })]), "w2");
  assert.deepEqual(r.workers.map((x) => x.worker_id), ["w2"]);
  assert.equal(r.team.published.planned_minutes, 540);
});

test("range validation and helpers", () => {
  assert.equal(validateRange("2026-11-01", "2026-11-30"), null);
  assert.ok(validateRange("2026-11-30", "2026-11-01"));
  assert.ok(validateRange("2026-01-01", "2026-12-31"));
  assert.equal(validateRange("2025-12-15", "2026-01-15"), null);
  assert.equal(weekStartOf("2026-11-12"), "2026-11-08");
  assert.equal(fmtMinutes(545), "9:05");
});

test("Hebrew visual ordering for PDF", () => {
  assert.equal(toVisual("תפעול בוקר"), "רקוב לועפת");
  assert.equal(toVisual("07:00–16:00"), "07:00–16:00");
  assert.equal(toVisual("שבוע 01/11/2026 – 07/11/2026"), "07/11/2026 – 01/11/2026 עובש");
  assert.equal(toVisual("סה״כ: 9:05"), "9:05 :כ״הס");
  assert.equal(toVisual("כונן לילה (2)"), "(2) הליל ןנוכ");
  assert.equal(toVisual("Hador Haba / Glow Glamping"), "Hador Haba / Glow Glamping");
});

const pdfReady = fs.existsSync("/tmp/Alef-Regular.ttf") && fs.existsSync("/tmp/Alef-Bold.ttf");
const fonts = pdfReady ? { regular: fs.readFileSync("/tmp/Alef-Regular.ttf").toString("base64"), bold: fs.readFileSync("/tmp/Alef-Bold.ttf").toString("base64") } : null;

// Records every string drawn into the PDF (jsPDF assigns text() per instance).
let drawnLog = [];
class SpyPDF extends JsPDF {
  constructor(...args) {
    super(...args);
    const orig = this.text.bind(this);
    this.text = (t, ...rest) => { drawnLog.push(String(t)); return orig(t, ...rest); };
  }
}
function spyDoc(build) {
  drawnLog = [];
  const doc = build(SpyPDF);
  return { doc, drawn: drawnLog };
}

function manyShifts(days, workerIds) {
  const out = [], schedules = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2026, 9, 25 + i, 12)).toISOString().slice(0, 10);
    const wk = weekStartOf(d);
    if (!schedules.find((s) => s.week_start_date === wk)) schedules.push({ id: "s" + wk, week_start_date: wk, status: i > 20 ? "DRAFT" : "PUBLISHED" });
    for (const wid of workerIds) {
      out.push(sh({ date: d, worker_id: wid, start_time: "07:00", end_time: "16:00", work_schedule_id: "s" + wk }));
      if (i % 3 === 0) out.push(sh({ date: d, worker_id: wid, row_type: "NIGHT_ON_CALL", row_label: "כונן לילה", start_time: null, end_time: null, work_schedule_id: "s" + wk }));
    }
  }
  return { shifts: out, schedules };
}

test("worker PDF: 1, 2, 4 weeks and custom range; only that worker; drafts only on request", { skip: !pdfReady }, () => {
  const { shifts, schedules } = manyShifts(28, ["w1", "w2"]);
  for (const [start, end] of [["2026-10-25", "2026-10-31"], ["2026-10-25", "2026-11-07"], ["2026-10-25", "2026-11-21"], ["2026-10-28", "2026-11-19"]]) {
    const r = filterReportToWorker(buildScheduleReport({ start, end, shifts, schedules, workers, generatedAt: "2026-11-12T10:00:00.000Z" }), "w1");
    const { doc, drawn } = spyDoc((P) => buildWorkerPdf(P, fonts, r, r.workers[0]));
    const bytes = Buffer.from(doc.output("arraybuffer"));
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(bytes.includes("FontFile2") && bytes.includes("ToUnicode"));
    assert.ok(drawn.includes(toVisual("עובד/ת: עובד א")));
    assert.ok(!drawn.some((t) => t.includes(toVisual("עובד ב"))));
    assert.ok(!drawn.includes(toVisual("טיוטה – לא פורסם")));
    // no truncation: one status cell per published shift
    assert.equal(drawn.filter((t) => t === toVisual("פורסם")).length, r.workers[0].items.filter((it) => it.status === "published").length);
  }
  const r = filterReportToWorker(buildScheduleReport({ start: "2026-10-25", end: "2026-11-21", shifts, schedules, workers }), "w1");
  const { doc, drawn } = spyDoc((P) => buildWorkerPdf(P, fonts, r, r.workers[0], { includeDrafts: true }));
  assert.ok(doc.getNumberOfPages() >= 2);
  assert.equal(drawn.filter((t) => t === toVisual("טיוטה – לא פורסם")).length, r.workers[0].items.filter((it) => it.status === "draft").length);
  assert.ok(drawn.filter((t) => t === toVisual("שעות מתוכננות")).length >= 2); // header repeated on page 2
  assert.ok(!drawn.some((t) => /HOURLY|GLOBAL|₪/.test(t)));
});

test("team PDF: multi-page landscape with repeated headers and every worker", { skip: !pdfReady }, () => {
  const ids = Array.from({ length: 9 }, (_, i) => "w" + (i + 1));
  const many = ids.map((id, i) => ({ id, full_name: `עובד ${i + 1}`, default_team: "OPERATIONS" }));
  const { shifts, schedules } = manyShifts(35, ids);
  const r = buildScheduleReport({ start: "2026-10-25", end: "2026-11-28", shifts, schedules, workers: many });
  const { doc, drawn } = spyDoc((P) => buildTeamPdf(P, fonts, r));
  assert.ok(doc.getNumberOfPages() >= 3);
  assert.ok(doc.internal.pageSize.getWidth() > doc.internal.pageSize.getHeight());
  assert.ok(drawn.filter((t) => t === toVisual("עובד/ת")).length >= 5);
  for (const n of many) assert.ok(drawn.includes(toVisual(n.full_name)));
  assert.ok(drawn.includes(toVisual("סיכום לתקופה")));
  fs.writeFileSync("/tmp/team-test.pdf", Buffer.from(doc.output("arraybuffer")));
});