import { base44 } from "@/api/base44Client";

// Client helpers for "דוחות סידור עבודה". All dates are Asia/Jerusalem calendar dates (YYYY-MM-DD).
export const todayInIsrael = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

export function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekStart = (date) => addDays(date, -new Date(date + "T12:00:00Z").getUTCDay());
const monthRange = (date) => {
  const [y, m] = date.split("-").map(Number);
  return { start: `${date.slice(0, 7)}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};

export const PRESETS = [
  { id: "week", label: "שבוע", days: 7 },
  { id: "2weeks", label: "שבועיים", days: 14 },
  { id: "4weeks", label: "4 שבועות", days: 28 },
  { id: "month", label: "חודש", days: null },
  { id: "custom", label: "טווח מותאם", days: null },
];

export function presetRange(preset, anchor = todayInIsrael()) {
  if (preset === "month") return monthRange(anchor);
  const p = PRESETS.find((x) => x.id === preset);
  const start = weekStart(anchor);
  return { start, end: addDays(start, (p?.days || 7) - 1) };
}

export function stepRange(preset, range, dir) {
  if (preset === "month") {
    const [y, m] = range.start.split("-").map(Number);
    return monthRange(new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10));
  }
  const days = PRESETS.find((x) => x.id === preset)?.days || 7;
  return { start: addDays(range.start, dir * days), end: addDays(range.end, dir * days) };
}

export const fmtMinutes = (min) => { const m = Math.round(min || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
export const fmtDate = (date) => { const [y, m, d] = date.split("-"); return `${d}/${m}/${y}`; };
export const errorText = (err, fallback) => err?.response?.data?.error || fallback;

export async function fetchReportPdf(params) {
  const { data } = await base44.functions.invoke("getWorkScheduleReport", { action: "pdf", ...params });
  const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
  return { blob: new Blob([bytes], { type: "application/pdf" }), filename: data.filename };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}