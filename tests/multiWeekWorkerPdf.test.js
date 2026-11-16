// Run: node --test tests/multiWeekWorkerPdf.test.js
// Multi-week personal schedule PDF (layout "weekly"). SIMULATED data only — no network, no writes.
// Needs /tmp/Alef-Regular.ttf and /tmp/Alef-Bold.ttf (the fonts the backend function downloads).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { jsPDF as JsPDF } from "jspdf";
import { buildScheduleReport, filterReportToWorker, addDays, weekStartOf } from "../base44/shared/workScheduleReport.js";
import { buildWorkerPdf, periodWeeks, weekBandText } from "../base44/shared/workSchedulePdf.js";
import { toVisual } from "../base44/shared/hebrewPdfText.js";

const START = "2026-11-15";
const workers = [{ id: "w1", full_name: "עובד א" }, { id: "w2", full_name: "עובד ב" }];
const schedules = ["2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29", "2026-12-06"].map((wk) => ({ id: "s" + wk, week_start_date: wk, status: wk === "2026-11-29" ? "DRAFT" : "PUBLISHED" }));
let n = 0;
const sh = (o) => ({ id: `x${n++}`, status: "PLANNED", row_type: "OPERATIONS_MORNING", row_label: "תפעול בוקר", ...o });
function shifts() {
  const out = [sh({ date: "2026-11-14", worker_id: "w1", row_type: "OPERATIONS_EVENING", row_label: "תפעול ערב", start_time: "22:00", end_time: "06:00", work_schedule_id: "s2026-11-08" })];
  for (let i = 0; i < 28; i++) {
    const date = addDays(START, i), sid = "s" + weekStartOf(date);
    for (const wid of ["w1", "w2"]) {
      out.push(sh({ date, worker_id: wid, start_time: "07:00", end_time: "15:00", work_schedule_id: sid }));
      if (i % 2 === 0) out.push(sh({ date, worker_id: wid, row_type: "OPERATIONS_EVENING", row_label: "תפעול ערב", start_time: "16:00", end_time: "23:00", work_schedule_id: sid }));
      if (i % 3 === 0) out.push(sh({ date, worker_id: wid, row_type: "NIGHT_ON_CALL", row_label: "כונן לילה", start_time: "", end_time: "", work_schedule_id: sid }));
      if (i === 3) out.push(sh({ date, worker_id: wid, row_type: "MAINTENANCE", row_label: "תחזוקה", start_time: "22:00", end_time: "06:00", work_schedule_id: sid }));
    }
  }
  return out;
}
const reportFor = (weeks, worker = "w1") => filterReportToWorker(buildScheduleReport({ start: START, end: addDays(START, weeks * 7 - 1), shifts: shifts(), schedules, workers, generatedAt: "2026-11-16T08:00:00.000Z" }), worker);

const pdfReady = fs.existsSync("/tmp/Alef-Regular.ttf") && fs.existsSync("/tmp/Alef-Bold.ttf");
const fonts = pdfReady ? { regular: fs.readFileSync("/tmp/Alef-Regular.ttf").toString("base64"), bold: fs.readFileSync("/tmp/Alef-Bold.ttf").toString("base64") } : null;
let log = [];
class SpyPDF extends JsPDF {
  constructor(...a) { super(...a); const orig = this.text.bind(this); this.text = (t, ...r) => { log.push(String(t)); return orig(t, ...r); }; }
}
const build = (report, opts) => { log = []; const doc = buildWorkerPdf(SpyPDF, fonts, report, report.workers[0], opts); return { doc, drawn: [...log] }; };

test("1–4 weeks: one document, title = range, one band per week in chronological order", { skip: !pdfReady }, () => {
  for (const weeks of [1, 2, 3, 4]) {
    const r = reportFor(weeks);
    const { doc, drawn } = build(r, { weekly: true });
    assert.equal(Buffer.from(doc.output("arraybuffer")).subarray(0, 5).toString(), "%PDF-");
    const end = addDays(START, weeks * 7 - 1).split("-").reverse().join("/");
    assert.ok(drawn.includes(toVisual(`סידור עבודה אישי – 15/11/2026 – ${end}`)), `title for ${weeks} weeks`);
    assert.ok(drawn.includes(toVisual(`טווח: 15/11/2026 – ${end}`)));
    const items = r.workers[0].items.filter((it) => it.status === "published");
    const first = periodWeeks(r)[0].week_start;
    const idx = periodWeeks(r).map((wk) => drawn.indexOf(toVisual(weekBandText(wk, items.filter((it) => { const k = weekStartOf(it.date); return (k < first ? first : k) === wk.week_start; }), false))));
    assert.equal(idx.length, weeks);
    assert.ok(idx.every((i) => i >= 0), "every week has a band");
    assert.deepEqual([...idx].sort((a, b) => a - b), idx, "bands are chronological");
    assert.equal(drawn.filter((t) => t === toVisual("פורסם")).length, items.length, "every published shift drawn once");
    assert.ok(drawn.includes("14/11/2026"), "overnight shift from the day before the range is kept");
    assert.ok(drawn.includes(toVisual("06:00 (+1)")), "overnight end marked");
    assert.ok(drawn.includes(toVisual("כונן לילה")));
  }
});

test("4 weeks: only the selected worker, no drafts, unpublished week named, multi-page", { skip: !pdfReady }, () => {
  const r = reportFor(4);
  const { doc, drawn } = build(r, { weekly: true });
  assert.ok(doc.getNumberOfPages() >= 2, "4 dense weeks paginate");
  assert.ok(drawn.filter((t) => t === toVisual("שעות מתוכננות")).length >= 2, "table header repeated per page");
  assert.ok(!drawn.some((t) => t.includes(toVisual("עובד ב"))), "no other worker");
  assert.ok(!drawn.includes(toVisual("טיוטה – לא פורסם")), "no draft rows");
  for (const day of ["29/11/2026", "30/11/2026", "01/12/2026", "05/12/2026"]) assert.ok(!drawn.includes(day), `draft-week day ${day} not listed`);
  assert.ok(drawn.includes(toVisual("שבוע 29/11/2026 – 05/12/2026 · טרם פורסם (טיוטה) – לא נכלל")));
  assert.ok(drawn.includes(toVisual("הסידור לשבוע זה טרם פורסם – המשמרות אינן כלולות במסמך.")));
  assert.ok(!drawn.some((t) => /₪|HOURLY|GLOBAL/.test(t)), "no salary data");
});

test("original single-week worker PDF keeps its layout (no bands, original title)", { skip: !pdfReady }, () => {
  const r = reportFor(1);
  const { drawn } = build(r);
  assert.ok(drawn.includes(toVisual("סידור עבודה אישי – משמרות מתוכננות")));
  assert.ok(!drawn.includes(toVisual("סידור עבודה אישי – 15/11/2026 – 21/11/2026")));
  assert.ok(!drawn.includes(toVisual(weekBandText(periodWeeks(r)[0], r.workers[0].items, false))));
});