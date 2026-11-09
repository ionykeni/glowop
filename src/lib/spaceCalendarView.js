// Display helpers for the visual common-spaces calendar (read-only).
export const GROUP_TYPE_LABELS = { MECHINA: "מכינה", LODGING: "קבוצת לינה", DAY_USE: "קבוצת יום", GENERAL: "פעילות כללית" };
export const DAY_NAMES = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export const TONE_COUNT = 8;
// Must match the server-side allow-list in getCommonSpacesCalendar.
export const SPACE_CALENDAR_ROLES = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "MAINTENANCE", "VIEWER"];

export const toMin = (t) => {
  const [h, m] = String(t || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : 0;
};
export const fmtMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const eventEnd = (e) => { const end = toMin(e.end_time); return end > toMin(e.start_time) ? end : 1440; };

export function israelNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export const weekStart = (date) => { const [y, m, d] = date.split("-").map(Number); return addDays(date, -new Date(Date.UTC(y, m - 1, d)).getUTCDay()); };
export const weekDates = (date) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
export const dayOfWeek = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

// Stable soft color per group (or per standalone activity) — never encodes status.
export function toneFor(event) {
  const key = event.group_ids?.[0] || `${event.group_type}:${event.title}`;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TONE_COUNT;
}

// Short label for the narrow phone column ("בולדר 1 — שכונה 1" → "ב1").
export function spaceCode(name) {
  const main = String(name).split("—")[0].trim();
  const words = main.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map(w => (/^[\d-]+$/.test(w) ? w : w[0])).join("").replace(/["׳]/g, "").slice(0, 4);
}

// Block interval [start, end) in minutes clipped to one day, or null.
export function blockRangeOnDay(block, date) {
  if (block.start_date > date || (!block.is_open_ended && block.end_date < date)) return null;
  const start = block.start_date < date ? 0 : toMin(block.start_time);
  const end = block.is_open_ended || block.end_date > date ? 1440 : toMin(block.end_time);
  return end > start ? [start, end] : null;
}

// Merged busy intervals (confirmed events + blocks). Pending requests are NOT busy.
export function busyIntervals(spaceEvents, spaceBlocks, date) {
  const raw = [
    ...spaceEvents.filter(e => e.status === "CONFIRMED").map(e => [toMin(e.start_time), eventEnd(e)]),
    ...spaceBlocks.map(b => blockRangeOnDay(b, date)).filter(Boolean),
  ].sort((a, b) => a[0] - b[0]);
  return raw.reduce((out, [s, e]) => {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
    return out;
  }, []);
}

// First minute ≥ at when the space is free again.
export function freeAgainAt(intervals, at) {
  const hit = intervals.find(([s, e]) => s <= at && at < e);
  return hit ? hit[1] : at;
}

export function statusAt(space, intervals, minutes) {
  if (!space.available) return { kind: "closed", label: space.unavailable_label || "לא זמין" };
  const current = intervals.find(([s, e]) => s <= minutes && minutes < e);
  if (current) return { kind: "busy", label: current[1] >= 1440 ? "תפוס עד סוף היום" : `תפוס עד ${fmtMin(current[1])}` };
  const next = intervals.find(([s]) => s > minutes);
  return { kind: "free", label: next ? `פנוי עד ${fmtMin(next[0])}` : "פנוי עד סוף היום" };
}

// Assign overlapping events to stacked lanes.
export function layoutLanes(events) {
  const sorted = [...events].sort((a, b) => toMin(a.start_time) - toMin(b.start_time) || eventEnd(b) - eventEnd(a));
  const laneEnds = [];
  const placed = sorted.map(e => {
    let lane = laneEnds.findIndex(end => end <= toMin(e.start_time));
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = eventEnd(e);
    return { event: e, lane };
  });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}