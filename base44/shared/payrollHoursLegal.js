// V1 is a classification of verified elapsed time, NOT a pay or entitlement calculator.
// Sources: Hours of Work and Rest Law §§1–3, 7, 16–17, 30; Ministry of Labor guidance
// https://www.gov.il/he/pages/overtime-and-extra-hours and https://www.gov.il/he/pages/weekends-and-holidays
// Daily overtime is determined first; only non-daily-overtime time can fill the weekly ordinary quota.
import { addDays, localToUtcMs } from './workScheduleReport.js';
import { MINUTE, instant, validDate, span } from './payrollHoursCalendar.js';

export const emptyLegal = () => ({ regular: 0, overtime125: 0, overtime150: 0, weekly_rest: 0, holiday: 0, unresolved: 0 });
export const sumSpans = (parts) => parts.reduce((total, p) => total + p.end - p.start, 0);
const minuteLimit = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function reviewedWeek(arrangements, week) {
  const end = addDays(week, 6);
  if (arrangements.some((p) => !validDate(p.effective_from) || !validDate(p.effective_through) || p.effective_from > p.effective_through)) return null;
  const relevant = arrangements.filter((p) => p.effective_from <= end && p.effective_through >= week);
  const p = relevant[0];
  if (relevant.length !== 1 || p.effective_from > week || p.effective_through < end || week < '2018-04-01'
    || p.inputs_verified !== true || p.rule !== 'IL_SECTION_16_SUN_SAT' || !p.review_reference?.trim()
    || !minuteLimit(p.weekly_regular_minutes, 1, 2520) || !Array.isArray(p.daily_limits) || !Array.isArray(p.special_windows)) return null;
  const limits = new Map();
  for (const x of p.daily_limits) {
    if (!validDate(x.date) || limits.has(x.date) || !minuteLimit(x.regular_minutes, 0, 600)) return null;
    limits.set(x.date, x.regular_minutes * MINUTE);
  }
  const windows = p.special_windows.map((w) => ({ start: instant(w.start_at), end: instant(w.end_at), kind: w.kind }));
  if (windows.some((w) => !(w.start < w.end) || !['weekly_rest', 'holiday'].includes(w.kind))) return null;
  return { limits, windows, weekly: p.weekly_regular_minutes * MINUTE };
}

function specialPieces(p, windows) {
  const relevant = windows.filter((w) => span(p.start, p.end, w.start, w.end) > 0);
  const points = [...new Set([p.start, p.end, ...relevant.flatMap((w) => [Math.max(w.start, p.start), Math.min(w.end, p.end)])])].sort((a, b) => a - b);
  return points.slice(1).map((end, i) => {
    const start = points[i];
    const kinds = new Set(relevant.filter((w) => w.start < end && w.end > start).map((w) => w.kind));
    return { start, end, kind: kinds.size > 1 ? 'unresolved' : [...kinds][0] };
  });
}

export function classifyPayrollWeek(week, days, arrangements) {
  const rule = reviewedWeek(arrangements, week);
  const result = new Map();
  const reasons = new Set();
  if (!rule) reasons.add('ARRANGEMENT');
  if (days.some((day) => day.review)) reasons.add('ATTENDANCE');
  for (const day of days) {
    const night = day.verified.reduce((n, p) => n + span(p.start, p.end, localToUtcMs(day.date), localToUtcMs(day.date, '06:00'))
      + span(p.start, p.end, localToUtcMs(day.date, '22:00'), localToUtcMs(addDays(day.date, 1))), 0);
    if (day.overnight || night >= 120 * MINUTE) reasons.add('NIGHT');
    if (rule && day.verified.length && !rule.limits.has(day.date)) reasons.add('DAILY_LIMIT');
  }
  const prepared = days.map((d) => ({ ...d, pieces: rule ? d.verified.flatMap((p) => specialPieces(p, rule.windows)) : d.verified }));
  if (prepared.some((d) => d.pieces.some((p) => p.kind))) reasons.add('SPECIAL');
  let weeklyRemaining = rule?.weekly ?? 0;
  for (const day of prepared) {
    const totals = emptyLegal();
    for (const p of day.pieces) if (p.kind) totals[p.kind] += p.end - p.start;
    const ordinary = sumSpans(day.pieces.filter((p) => !p.kind));
    if (reasons.size) totals.unresolved += ordinary;
    else if (ordinary) {
      const dailyOrdinary = Math.min(ordinary, rule.limits.get(day.date));
      totals.regular = Math.min(dailyOrdinary, weeklyRemaining);
      weeklyRemaining -= totals.regular;
      const overtime = ordinary - totals.regular;
      totals.overtime125 = Math.min(overtime, 120 * MINUTE);
      totals.overtime150 = overtime - totals.overtime125;
    }
    result.set(day.date, totals);
  }
  return { days: result, reasons: [...reasons] };
}