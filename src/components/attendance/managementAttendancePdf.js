import { fmtDateTime } from "@/lib/attendanceFormat";
import { extraDetails, REPORT_NOTE, SHIFT_HEADERS, shiftDetails, workerNotes, workerSummary, WORKER_HEADERS } from "./attendanceReportPresentation";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const bidi = (v) => `<bdi dir="ltr">${escape(v)}</bdi>`;
const headings = (labels) => `<tr>${labels.map((h) => `<th scope="col">${escape(h)}</th>`).join("")}</tr>`;

function workerPage(worker, generatedAt) {
  const [name, ...totals] = workerSummary(worker, generatedAt);
  const notes = workerNotes(worker);
  const rows = (worker.comparison?.shifts || []).map((shift) => {
    const s = shiftDetails(shift);
    return `<tr><td>${escape(s.date)}<small>${escape(s.label)}</small></td><td>${s.planned ? bidi(s.planned) : "כוננות לילה"}${s.overnight ? "<small>עד למחרת</small>" : ""}</td><td>${s.sessions.map((x) => `<div>${bidi(x.time)}${x.label ? `<small>${escape(x.label)}</small>` : ""}</div>`).join("") || "—"}</td><td>${s.notes.map((n) => `<div>${escape(n)}</div>`).join("") || "—"}</td></tr>`;
  }).join("");
  const extra = (worker.comparison?.extra || []).map((x) => {
    const e = extraDetails(x);
    return `<tr><td>${escape(e.date)}</td><td>${bidi(e.time)}</td><td>${bidi(e.duration)}</td><td>${escape(e.label)}</td></tr>`;
  }).join("");
  return `<section class="employee">
    <div class="employee-summary"><h2>${escape(name)}</h2><table class="totals"><thead>${headings(WORKER_HEADERS.slice(1))}</thead><tbody><tr>${totals.map((x) => `<td>${bidi(x)}</td>`).join("")}</tr></tbody></table>${notes.length ? `<ul>${notes.map((n) => `<li>${escape(n)}</li>`).join("")}</ul>` : ""}</div>
    ${rows ? `<table class="shifts"><colgroup><col class="col-date"><col class="col-planned"><col class="col-actual"><col class="col-note"></colgroup><thead><tr><th colspan="4" class="section-title">פירוט משמרות · ${escape(name)}</th></tr>${headings(SHIFT_HEADERS)}</thead><tbody>${rows}</tbody></table>` : "<p>אין משמרות מתוכננות בתקופה זו.</p>"}
    ${extra ? `<table class="extra"><thead><tr><th colspan="4" class="section-title">נוכחות מחוץ למשמרת מתוכננת · ${escape(name)}</th></tr>${headings(["תאריך", "שעות", "משך", "הערה"])}</thead><tbody>${extra}</tbody></table>` : ""}
  </section>`;
}

export function printManagementAttendance(report, monthLabel) {
  const view = window.open("", "_blank");
  if (!view) return false;
  view.opener = null;
  view.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח נוכחות ניהולי · ${escape(monthLabel)}</title><style>
    @page{size:A4 portrait;margin:14mm 13mm} *{box-sizing:border-box} body{margin:0;color:#20252d;font:10pt/1.45 Arial,sans-serif} header{border-bottom:1pt solid #354556;padding-bottom:3mm;margin-bottom:4mm} h1{font-size:21pt;margin:0 0 1mm} h2{font-size:15pt;margin:0 0 2mm} header p,.intro{margin:0;color:#4b5563} .intro{margin-bottom:5mm} .employee+.employee{break-before:page} .employee-summary,header{break-inside:avoid;break-after:avoid} table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:4mm} th,td{text-align:right;vertical-align:top;border-bottom:1px solid #d7dde4;padding:1.6mm 2mm;overflow-wrap:anywhere} th{font-weight:600;background:#f1f4f7} small{display:block;color:#4b5563;font-size:8.5pt} thead{display:table-header-group} tr{break-inside:avoid} .section-title{background:none;border-bottom:1pt solid #687888} .col-date{width:20%} .col-planned{width:18%} .col-actual{width:24%} .col-note{width:38%} ul{padding-inline-start:5mm;margin:0 0 3mm;color:#4b5563}
    @media screen{body{max-width:184mm;margin:12mm auto;padding:0 4mm}.employee+.employee{margin-top:8mm}.print-button{margin-bottom:5mm}} @media print{.print-button{display:none}th{print-color-adjust:exact}}
    </style></head><body><button class="print-button" type="button">הדפסה / שמירה כ־PDF</button>
    <header><h1>דוח נוכחות ניהולי</h1><p>${escape(monthLabel)}${report.generated_at ? ` · הופק ${escape(fmtDateTime(report.generated_at))}` : ""}</p></header>
    <p class="intro">${escape(REPORT_NOTE)} אין בדוח חישובי שכר.</p>
    ${report.workers.map((w) => workerPage(w, report.generated_at)).join("")}</body></html>`);
  view.document.close();
  view.document.querySelector(".print-button").addEventListener("click", () => view.print());
  view.focus();
  // Let the document lay out before opening the browser's print / Save as PDF dialog.
  view.requestAnimationFrame(() => view.requestAnimationFrame(() => view.print()));
  return true;
}