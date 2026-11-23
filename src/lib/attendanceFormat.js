// Display helpers for the attendance module. All times are shown in Asia/Jerusalem.
const TZ = "Asia/Jerusalem";
const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const isoDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "numeric" });
const monthFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "UTC", month: "long", year: "numeric" });
const pad = (n) => String(n).padStart(2, "0");

export const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : "—");
export const localDate = (iso) => isoDateFmt.format(new Date(iso));
export const fmtDay = (date) => (date ? dayFmt.format(new Date(`${date}T12:00:00Z`)) : "");
export const fmtDateTime = (iso) => (iso ? `${fmtDay(localDate(iso))} ${fmtTime(iso)}` : "—");
export const israelToday = () => localDate(new Date().toISOString());

export function fmtMinutes(minutes) {
  const v = Math.max(0, Math.round(minutes || 0));
  return `${Math.floor(v / 60)}:${pad(v % 60)}`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekStartOf = (date) => addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
export const monthOf = (date) => date.slice(0, 7);
export function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
export const monthTitle = (month) => monthFmt.format(new Date(`${month}-15T12:00:00Z`));

export const STATUS_META = {
  ACTIVE: { label: "בעבודה כעת", cls: "bg-primary/10 text-primary" },
  NORMAL: { label: "תקין", cls: "bg-emerald-50 text-emerald-700" },
  CORRECTED: { label: "תוקן ידנית", cls: "bg-amber-50 text-amber-700" },
  NEEDS_REVIEW: { label: "נסגר אוטומטית — דורש בדיקה", cls: "bg-red-100 text-red-700" },
  VOIDED: { label: "בוטל", cls: "bg-muted text-muted-foreground" },
};

export const CHANGE_LABELS = {
  CREATE_MANUAL: "הוספת שעות ידנית",
  EDIT_START: "תיקון שעת התחלה",
  EDIT_END: "תיקון שעת סיום",
  EDIT_TIMES: "תיקון שעות התחלה וסיום",
  RESOLVE_AUTO_CLOSE: "תיקון סגירה אוטומטית",
  CONFIRM: "אישור השעות",
  VOID: "ביטול רשומה",
};