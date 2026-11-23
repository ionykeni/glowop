import { fmtDay, fmtMinutes, fmtSigned, fmtTime, localDate } from "@/lib/attendanceFormat";

export const WORKER_HEADERS = ["עובד", "משמרות", "שעות מתוכננות", "שעות בפועל", "הפרש"];
export const SHIFT_HEADERS = ["תאריך", "מתוכנן", "בפועל", "הערה"];
export const REPORT_NOTE = "השעות בפועל בטבלה הן שעות מאושרות בלבד. ההפרש מחושב מול התכנון עד מועד הרענון, ורק כשיש רישומים זמינים להשוואה; אחרת מוצג קו. היעדר רישום, גם לפני תחילת השימוש בשעון, אינו מעיד על היעדרות. התכנון מבוסס על הסידור המפורסם כיום.";

const kindLabel = { verified: "מאושר", unverified: "סגירה אוטומטית, לא מאושר", active: "עדיין בעבודה" };
const range = (a, b) => `${a || "—"}–${b || "—"}`;
const difference = (minutes, edge) => minutes === 0 ? `בדיוק ב${edge}` : `${Math.abs(minutes)} דקות ${minutes < 0 ? "לפני" : "אחרי"} ${edge}`;

export function workerSummary(worker, generatedAt) {
  const c = worker.comparison;
  const started = generatedAt ? `${localDate(generatedAt)} ${fmtTime(generatedAt)}` : null;
  const canCompare = c?.planned_to_date_minutes > 0 && !worker.unverified_minutes && !worker.active_minutes
    && !c.shifts.some((s) => s.state === "NO_RECORD" || s.state === "INVALID_TIMES"
      || (s.state === "UPCOMING" && started && `${s.date} ${s.start_time}` < started));
  return [worker.worker_name || "ללא שם", c?.planned_shift_count ?? "—", c ? fmtMinutes(c.planned_minutes) : "—", fmtMinutes(worker.verified_minutes), canCompare ? fmtSigned(worker.verified_minutes - c.planned_to_date_minutes) : "—"];
}

export function shiftDetails(s) {
  const notes = [];
  if (s.state === "NO_RECORD") notes.push("אין רישום נוכחות לתאריך זה; אין להסיק מכך היעדרות.");
  if (s.state === "UPCOMING") notes.push("המשמרת טרם הסתיימה; אין עדיין השוואה.");
  if (s.state === "INVALID_TIMES") notes.push("חסרות שעות מתוכננות תקינות.");
  if (s.state === "RECORDED") {
    if (s.arrival_continuous) notes.push("כניסה: המשך מהמשמרת הקודמת.");
    else if (s.arrival_diff_minutes != null) notes.push(`כניסה: ${difference(s.arrival_diff_minutes, "תחילת המשמרת")}.`);
    if (s.departure_kind === "active") notes.push("יציאה: טרם נרשמה.");
    else if (s.departure_kind === "unverified") notes.push("יציאה: סגירה אוטומטית, לא מאושרת.");
    else if (s.departure_continuous) notes.push("יציאה: המשך למשמרת הבאה.");
    else if (s.departure_diff_minutes != null) notes.push(`יציאה: ${difference(s.departure_diff_minutes, "סיום המשמרת")}.`);
  }
  if (s.pending_correction) notes.push("בקשת תיקון ממתינה לאישור.");
  if (s.overlaps_other_shift) notes.push("חופפת למשמרת אחרת; שעות חופפות נספרות פעם אחת.");
  if (s.starts_before_period) notes.push("התחילה לפני תחילת התקופה.");
  return {
    date: fmtDay(s.date), label: s.row_label, planned: s.is_on_call ? null : range(s.start_time, s.end_time), overnight: s.overnight,
    sessions: (s.sessions || []).map((x) => ({ time: range(fmtTime(x.start_at), fmtTime(x.end_at)), label: x.kind === "verified" ? "" : kindLabel[x.kind] })), notes,
  };
}

export function workerNotes(w) {
  const c = w.comparison;
  return [
    c?.no_record_count > 0 && `משמרות ללא רישום: ${c.no_record_count}`,
    c?.pending_count > 0 && `בקשות תיקון ממתינות: ${c.pending_count} (לא נכללות בסיכום עד לאישור)`,
    w.unverified_minutes > 0 && `שעות לא מאושרות: ${fmtMinutes(w.unverified_minutes)}`,
    w.active_minutes > 0 && `נוכחות שעדיין פתוחה: ${fmtMinutes(w.active_minutes)}`,
    w.corrected_count > 0 && `רשומות שעברו תיקון: ${w.corrected_count}`,
  ].filter(Boolean);
}

export function extraDetails(x) {
  return { date: fmtDay(x.date), time: range(fmtTime(x.start_at), fmtTime(x.end_at)), duration: fmtMinutes(x.minutes), label: kindLabel[x.kind] };
}