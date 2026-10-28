// Google Calendar + ICS export helpers for an employee's own work shifts.
// Source of truth: WorkShift records (date + start_time + end_time + row_label + notes).
// Overnight shifts (end_time <= start_time) end on the following day.
// Time zone is always Asia/Jerusalem.

const LOCATION = "חוות אהרונסון, עתלית";
const TIMEZONE = "Asia/Jerusalem";
const DEFAULT_TITLE = "משמרת - Glow Glamping";

// Parse "HH:MM" into {h, m}
function parseTime(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

// Pad a number to 2 digits
const pad = (n) => String(n).padStart(2, "0");

// Build a local Date from a YYYY-MM-DD date string + HH:MM time
function toLocalDate(dateStr, time) {
  const t = parseTime(time);
  if (!t) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, t.h, t.m, 0, 0);
}

// Format a Date as YYYYMMDDTHHMMSS (local, no Z — paired with ctz/TZID)
function toIcsStamp(dt) {
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
}

// Format a Date as YYYYMMDD
function toDayStamp(dt) {
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}

// Add one day to a date string (YYYY-MM-DD)
function nextDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Resolve start/end Date for a shift, handling overnight (end <= start → end on next day)
export function resolveShiftRange(shift) {
  const start = toLocalDate(shift.date, shift.start_time);
  if (!start) return null;
  const endDateStr = shift.end_time && parseTime(shift.end_time) && shift.start_time &&
    parseTime(shift.end_time).h * 60 + parseTime(shift.end_time).m <= parseTime(shift.start_time).h * 60 + parseTime(shift.start_time).m
      ? nextDay(shift.date)
      : shift.date;
  const end = toLocalDate(endDateStr, shift.end_time);
  if (!end) return null;
  return { start, end };
}

export function isShiftExportable(shift) {
  return !!shift && shift.status !== "CANCELLED" && !!shift.date && !!shift.start_time && !!shift.end_time;
}

function escapeIcs(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function escapeUrl(text) {
  return encodeURIComponent(String(text || ""));
}

// Build a Google Calendar event-creation URL for a single shift
export function buildGoogleCalendarUrl(shift) {
  const range = resolveShiftRange(shift);
  if (!range) return null;
  const dates = `${toIcsStamp(range.start)}/${toIcsStamp(range.end)}`;
  const details = [shift.row_label, shift.notes].filter(Boolean).join(" — ");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: DEFAULT_TITLE,
    dates,
    ctz: TIMEZONE,
    location: LOCATION,
  });
  if (details) params.set("details", details);
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

// Build a .ics calendar string for a list of shifts
export function buildIcsCalendar(shifts) {
  const now = new Date();
  const dtstamp = toIcsStamp(now);
  let lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Glow Glamping//My Shifts//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const eligible = (shifts || []).filter(isShiftExportable).sort((a, b) => {
    const ra = resolveShiftRange(a), rb = resolveShiftRange(b);
    return (ra?.start?.getTime() || 0) - (rb?.start?.getTime() || 0);
  });
  for (const shift of eligible) {
    const range = resolveShiftRange(shift);
    if (!range) continue;
    const uid = `${shift.id}@glow-glamping-shifts`;
    const description = [shift.row_label, shift.notes].filter(Boolean).join(" — ");
    lines = lines.concat([
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${TIMEZONE}:${toIcsStamp(range.start)}`,
      `DTEND;TZID=${TIMEZONE}:${toIcsStamp(range.end)}`,
      `SUMMARY:${escapeIcs(DEFAULT_TITLE)}`,
      `LOCATION:${escapeIcs(LOCATION)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      "END:VEVENT",
    ]);
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// Trigger a browser download of the .ics file
export function downloadIcsCalendar(shifts) {
  const ics = buildIcsCalendar(shifts);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "my-shifts.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}