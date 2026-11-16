// Helpers for multi-week personal schedule sharing (WhatsApp handoff). Pure — no SDK, testable in node.
const addDays = (date, n) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDate = (date) => { const [y, m, d] = date.split("-"); return `${d}/${m}/${y}`; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SHARE_DAYS = 186;

export const PERIOD_OPTIONS = [
  { value: "1", label: "שבוע אחד (כמו היום)" },
  { value: "2", label: "שבועיים רצופים" },
  { value: "3", label: "3 שבועות רצופים" },
  { value: "4", label: "4 שבועות רצופים" },
  { value: "custom", label: "טווח תאריכים מותאם" },
];

export const shiftWeek = (weekStart, dir) => addDays(weekStart, dir * 7);
export const rangeText = (range) => `${fmtDate(range.start)} – ${fmtDate(range.end)}`;
export const fmtShareDate = fmtDate;

// period: { mode: "1"|"2"|"3"|"4"|"custom", startWeek, customStart, customEnd } → { range } or { error }
export function periodRange(period) {
  if (period.mode === "custom") {
    const { customStart: start, customEnd: end } = period;
    if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) return { error: "יש לבחור תאריכי התחלה וסיום" };
    if (end < start) return { error: "תאריך הסיום מוקדם מתאריך ההתחלה" };
    if ((Date.parse(end) - Date.parse(start)) / 86400000 + 1 > MAX_SHARE_DAYS) return { error: `ניתן לבחור עד ${MAX_SHARE_DAYS} ימים` };
    return { range: { start, end } };
  }
  const weeks = Number(period.mode) || 1;
  return { range: { start: period.startWeek, end: addDays(period.startWeek, weeks * 7 - 1) } };
}

const STATUS_TEXT = { DRAFT: "טיוטה", MISSING: "אין סידור" };
// Unpublished weeks of the report, clipped to the selected range.
export const missingWeekLabels = (report, range) => (report?.unpublished_weeks || []).map((w) =>
  `${fmtDate(w.week_start < range.start ? range.start : w.week_start)} – ${fmtDate(w.week_end > range.end ? range.end : w.week_end)} (${STATUS_TEXT[w.status] || "לא פורסם"})`);

export function multiWeekMessage(name, range, missing = []) {
  const lines = [`${name} שלום,`, `מצורף סידור העבודה שלך לתאריכים ${rangeText(range)} (קובץ PDF).`];
  if (missing.length) lines.push("", "שים לב: השבועות הבאים טרם פורסמו ואינם כלולים בקובץ:", ...missing);
  lines.push("", "תודה");
  return lines.join("\n");
}

// Israeli local numbers (05X…) → international digits for wa.me. Returns "" when unusable.
export function waPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "972" + digits.slice(1);
  return digits.length >= 11 && digits.length <= 15 ? digits : "";
}
export const waLink = (phone, text) => `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`;