const TZ = "Asia/Jerusalem";

export const OCC_STATE = {
  OVERDUE: { label: "באיחור", cls: "bg-red-100 text-red-700 border-red-200" },
  PENDING: { label: "ממתין", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  COMPLETED: { label: "בוצע", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

export const UNIT_STATE = {
  NO_RECORD: { label: "לא תועד ניקוי", badge: "bg-slate-200 text-slate-700", card: "border-slate-300 bg-slate-50" },
  DUE: { label: "נדרש ניקוי", badge: "bg-red-600 text-white", card: "border-red-300 bg-red-50" },
  APPROACHING: { label: "מתקרב", badge: "bg-amber-400 text-amber-950", card: "border-amber-300 bg-amber-50" },
  OK: { label: "תקין", badge: "bg-emerald-100 text-emerald-800", card: "border-emerald-200 bg-card" },
};

export const RECURRENCE_LABELS = { WEEKLY: "שבועית", MONTHLY: "חודשית", EVERY_N_DAYS: "לפי מרווח ימים" };

export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString("he-IL", {
  timeZone: TZ, day: "numeric", month: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit",
}) : "");

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString("he-IL", {
  timeZone: TZ, day: "numeric", month: "numeric", year: "2-digit",
}) : "");

const dm = (ymd) => { const [, m, d] = ymd.split("-"); return `${Number(d)}.${Number(m)}`; };
export const periodText = (start, end) => `${dm(start)} עד ${dm(end)}`;
export const monthLabel = (start) => new Date(`${start}T12:00:00Z`).toLocaleDateString("he-IL", { month: "long", year: "numeric", timeZone: "UTC" });