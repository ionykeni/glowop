import { fmtDay, fmtMinutes, fmtSigned, fmtTime, localDate } from "@/lib/attendanceFormat";

export const WORKER_HEADERS = ["עובד", "משמרות", "שעות מתוכננות", "שעות בפועל", "הפרש"];
export const SHIFT_HEADERS = ["תאריך", "מתוכנן", "בפועל", "כניסה / יציאה", "סה״כ"];
export const REPORT_NOTE = "השעות בפועל בטבלה הן שעות מאושרות בלבד. ההפרש מחושב מול התכנון עד מועד הרענון, ורק כשיש רישומים זמינים להשוואה; אחרת מוצג קו. היעדר רישום, גם לפני תחילת השימוש בשעון, אינו מעיד על היעדרות. התכנון מבוסס על הסידור המפורסם כיום.";

const kindLabel = { verified: "מאושר", unverified: "סגירה אוטומטית, לא מאושר", active: "עדיין בעבודה" };
const range = (a, b) => `${a || "—"}–${b || "—"}`;
// Tones: good / bad / warn / neutral. Display only — the server values are shown as they are.
const gap = (m) => (m < 60 ? `${m} דק׳` : `${fmtMinutes(m)} ש׳`);
const STATE_TEXT = { NO_RECORD: "אין רישום", UPCOMING: "טרם הסתיימה", INVALID_TIMES: "שעות חסרות", ON_CALL: "כוננות לילה" };

function entryOf(s) {
  if (s.arrival_continuous) return { text: "רציף מהמשמרת הקודמת", tone: "neutral" };
  const n = s.arrival_diff_minutes;
  if (n == null) return { text: "—", tone: "neutral" };
  if (n === 0) return { text: "בזמן", tone: "neutral" };
  return n > 0 ? { text: `${gap(n)} אחרי`, tone: "bad" } : { text: `${gap(-n)} לפני`, tone: "good" };
}

function exitOf(s) {
  if (s.departure_kind === "active") return { text: "עדיין בעבודה", tone: "neutral" };
  if (s.departure_kind === "unverified") return { text: "סגירה אוטומטית", tone: "warn" };
  if (s.departure_continuous) return { text: "רציף למשמרת הבאה", tone: "neutral" };
  const n = s.departure_diff_minutes;
  if (n == null) return { text: "—", tone: "neutral" };
  if (n === 0) return { text: "בזמן", tone: "neutral" };
  return n > 0 ? { text: `${gap(n)} אחרי`, tone: "good" } : { text: `${gap(-n)} לפני`, tone: "bad" };
}

// Net of the shown sessions against the planned shift; only when both edges are known and every session is verified.
function totalOf(s) {
  if (s.state !== "RECORDED" || s.arrival_diff_minutes == null || s.departure_diff_minutes == null || s.sessions.some((x) => x.kind !== "verified")) return null;
  const actual = s.sessions.reduce((t, x) => t + Math.round((Date.parse(x.end_at) - Date.parse(x.start_at)) / 60000), 0);
  const diff = actual - s.planned_minutes;
  return diff === 0 ? { text: "תואם", tone: "neutral" } : { text: fmtSigned(diff), tone: diff > 0 ? "good" : "bad" };
}

export function workerSummary(worker, generatedAt) {
  const c = worker.comparison;
  const started = generatedAt ? `${localDate(generatedAt)} ${fmtTime(generatedAt)}` : null;
  const canCompare = c?.planned_to_date_minutes > 0 && !worker.unverified_minutes && !worker.active_minutes
    && !c.shifts.some((s) => s.state === "NO_RECORD" || s.state === "INVALID_TIMES"
      || (s.state === "UPCOMING" && started && `${s.date} ${s.start_time}` < started));
  return [worker.worker_name || "ללא שם", c?.planned_shift_count ?? "—", c ? fmtMinutes(c.planned_minutes) : "—", fmtMinutes(worker.verified_minutes), canCompare ? fmtSigned(worker.verified_minutes - c.planned_to_date_minutes) : "—"];
}

export function shiftDetails(s) {
  const recorded = s.state === "RECORDED";
  const sessions = s.sessions || [];
  const notes = [];
  if (s.state === "NO_RECORD") notes.push("אינו מעיד על היעדרות");
  if (s.pending_correction) notes.push("בקשת תיקון ממתינה");
  if (s.overlaps_other_shift) notes.push("חופפת למשמרת אחרת, נספר פעם אחת");
  if (s.starts_before_period) notes.push("התחילה לפני התקופה");
  return {
    date: fmtDay(s.date), label: s.row_label, planned: s.is_on_call ? null : range(s.start_time, s.end_time), overnight: s.overnight,
    actual: sessions.length ? range(fmtTime(sessions[0].start_at), fmtTime(sessions[sessions.length - 1].end_at)) : null,
    sessions: sessions.length > 1 || sessions.some((x) => x.kind !== "verified")
      ? sessions.map((x) => ({ time: range(fmtTime(x.start_at), fmtTime(x.end_at)), label: x.kind === "verified" ? "" : kindLabel[x.kind] })) : [],
    status: recorded ? null : STATE_TEXT[s.state],
    entry: recorded ? entryOf(s) : null, exit: recorded ? exitOf(s) : null, total: recorded ? totalOf(s) : null, notes,
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