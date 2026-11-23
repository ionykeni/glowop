// Actual-hours totals from attendance records only (never planned WorkShift hours). Pure, no I/O.
// - Minutes are elapsed real time from UTC timestamps (overnight and DST safe).
// - Each session's minutes are allocated to the Asia/Jerusalem dates they actually occurred on, clipped to the period.
// - Per worker, time already counted is never counted again (defensive against any overlapping data).
// - verified = closed by the employee or corrected; unverified = automatic 13h cutoff awaiting review; active = running now.
import { localToUtcMs, addDays, splitByLocalDay } from './workScheduleReport.js';
import { effectiveEndMs, displayStatus } from './attendancePolicy.js';

const emptyTotals = () => ({ verified_minutes: 0, unverified_minutes: 0, active_minutes: 0, session_count: 0, auto_closed_count: 0, corrected_count: 0 });

export function buildAttendanceTotals(records, startDate, endDate, nowMs) {
  const pStart = localToUtcMs(startDate), pEnd = localToUtcMs(addDays(endDate, 1));
  const workers = {};
  const sorted = records.filter((r) => r.status !== 'VOIDED').sort((a, b) => a.effective_start_at.localeCompare(b.effective_start_at));
  for (const r of sorted) {
    const s = Date.parse(r.effective_start_at), e = effectiveEndMs(r, nowMs);
    if (!e || s >= pEnd || e <= pStart) continue;
    const shown = displayStatus(r, nowMs);
    const kind = shown === 'NEEDS_REVIEW' ? 'unverified' : shown === 'ACTIVE' ? 'active' : 'verified';
    const w = workers[r.worker_profile_id] || (workers[r.worker_profile_id] = { worker_id: r.worker_profile_id, worker_name: r.worker_name_snapshot || '', ...emptyTotals(), days: {}, _cursor: -Infinity });
    w.session_count += 1;
    if (shown === 'NEEDS_REVIEW') w.auto_closed_count += 1;
    if (r.is_corrected) w.corrected_count += 1;
    const a = Math.max(s, pStart, w._cursor), b = Math.min(e, pEnd);
    if (b > a) {
      for (const seg of splitByLocalDay(a, b)) {
        w[`${kind}_minutes`] += seg.minutes;
        const day = w.days[seg.date] || (w.days[seg.date] = { date: seg.date, verified_minutes: 0, unverified_minutes: 0, active_minutes: 0 });
        day[`${kind}_minutes`] += seg.minutes;
      }
    }
    w._cursor = Math.max(w._cursor, e);
  }
  const list = Object.values(workers).map(({ _cursor, days, ...w }) => ({ ...w, days: Object.values(days).sort((x, y) => x.date.localeCompare(y.date)) }))
    .sort((a, b) => a.worker_name.localeCompare(b.worker_name, 'he'));
  const team = emptyTotals();
  for (const w of list) for (const k of Object.keys(team)) team[k] += w[k];
  return { workers: list, team };
}