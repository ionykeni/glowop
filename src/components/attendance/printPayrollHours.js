import { addDays, fmtDay } from "../../lib/attendanceFormat.js";
import { PAYROLL_NOTICE, PAYROLL_METHOD, PAYROLL_LEGAL, PAYROLL_REASONS, PAYROLL_SUMMARY, PAYROLL_HEADERS, PAYROLL_REQUEST_HEADERS, PAYROLL_REQUEST_TYPES, duration, stamp, endText, rowStatus, requestStatus } from "./payrollPresentation.js";
import { payrollPdfStyles } from "./payrollPdfStyles.js";

const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const time = (ms) => `<bdi dir="ltr">${duration(ms)}</bdi>`;
const headers = (labels, name) => `<thead><tr><th colspan="${labels.length}">${safe(name)} · ${PAYROLL_NOTICE}</th></tr><tr>${labels.map((s) => `<th scope="col">${safe(s)}</th>`).join("")}</tr></thead>`;
const cell = (v) => `<td>${safe(v)}</td>`;
const metrics = (labels, values) => Object.entries(labels).map(([k, title]) => `<div><dt>${title}</dt><dd>${time(values[k])}</dd></div>`).join("");

function summary(entity, heading, team = false) {
  return `<div class="summary"><h3>${heading}</h3><p class="meta">${entity.worked_days} ${team ? "ימי עבודה מצטברים עם שעות מאומתות" : "ימים עם שעות מאומתות"} · ${entity.pending_count} בקשות ממתינות</p>
    <dl>${metrics(PAYROLL_SUMMARY, entity.hours)}</dl><h3>סיווג שעות מאומתות</h3><dl class="legal">${metrics(PAYROLL_LEGAL, entity.legal)}</dl>
    ${entity.legal.weekly_rest || entity.legal.holiday ? '<p class="meta">זמני מנוחה וחג זוהו לפי מועדים מאומתים; שיעורי התגמול וסיווג שעות נוספות בזמנים אלה דורשים בירור.</p>' : ''}</div>`;
}

function daysTable(worker) {
  if (!worker.days.length) return "";
  return `<table><caption>רשומות יומיות</caption>${headers(PAYROLL_HEADERS, worker.full_name)}<tbody>${worker.days.map((d) => d.rows.map((r, i) => `<tr${r.kind !== 'verified' ? ' class="not-verified"' : ''}>${cell(i ? "" : fmtDay(d.date))}${cell(stamp(r.start_at))}${cell(endText(r))}<td>${time(r.session_ms)}${r.day_ms != null && r.day_ms !== r.session_ms ? `<small>חלק ביום: ${time(r.day_ms)}</small>` : ""}</td><td>${time(r.counted_ms)}</td>${cell(rowStatus(r))}</tr>`).join("")
    + `<tr class="subtotal"><td colspan="6"><strong>סה״כ ליום · </strong>${Object.entries(PAYROLL_SUMMARY).filter(([k]) => k === "verified" || d.hours[k] > 0).map(([k, label]) => `${label}: ${time(d.hours[k])}`).join(" · ")}</td></tr>`).join("")}</tbody></table>`;
}

function requestsTable(worker) {
  return worker.pending.length ? `<table><caption>בקשות תיקון ממתינות (השעות המבוקשות לא נספרו)</caption>${headers(PAYROLL_REQUEST_HEADERS, worker.full_name)}<tbody>${worker.pending.map((r) => `<tr>${[fmtDay(r.date), PAYROLL_REQUEST_TYPES[r.type], stamp(r.start_at), stamp(r.end_at), requestStatus(r)].map(cell).join("")}</tr>`).join("")}</tbody></table>` : "";
}

export function payrollPrintHtml(report, label) {
  const workers = report.workers.map((w, i) => `<section${i ? ' class="next-worker"' : ''}><h2>${safe(w.full_name)} · ${safe(label)}</h2>${summary(w, "סיכום חודשי לעובד")}
    ${w.review_weeks.length ? `<div class="review"><strong>נדרש בירור</strong><ul>${w.review_weeks.map(({ week, reasons }) => `<li>${fmtDay(week)} – ${fmtDay(addDays(week, 6))}: ${safe(reasons.map((r) => PAYROLL_REASONS[r]).join(" "))}</li>`).join("")}</ul></div>` : ""}
    ${daysTable(w)}${requestsTable(w)}${!w.days.length && !w.pending.length ? "<p>אין רשומות נוכחות בחודש זה.</p>" : ""}</section>`).join("");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח שעות לשכר · ${safe(label)}</title><style>${payrollPdfStyles}</style></head><body><main>
    <header><h1>דוח שעות לשכר · ${safe(label)}</h1><p class="notice">${PAYROLL_NOTICE}</p><p class="meta">נכון ל־${safe(stamp(report.generated_at))} · ${PAYROLL_METHOD}</p></header>
    ${report.worker_id ? "" : summary(report.team, "סיכום חודשי לכל העובדים", true)}${workers}</main></body></html>`;
}

export function printPayrollHours(report, label) {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  popup.document.open();
  popup.document.write(payrollPrintHtml(report, label));
  popup.document.close();
  popup.document.fonts.ready.then(() => { if (!popup.closed) { popup.focus(); popup.print(); } });
  return true;
}