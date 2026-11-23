// Planned-vs-actual comparison for the attendance report. Pure, no I/O, informational only (no tolerance, no scoring).
// - Planned = the shifts passed in (currently PLANNED shifts of currently PUBLISHED schedules). Nothing historical is reconstructed.
// - Planned minutes are the union of a worker's shift intervals (overlapping shifts are counted once), clipped to the period.
// - Actual time comes from attendance records; a minute already counted for a worker is never counted again.
// - Each actual minute is attributed to at most one shift (the earliest-starting one that covers it); the rest is "extra" time.
// - A finished shift with no attendance is NO_RECORD (needs review) — never an absence.
import { localToUtcMs, addDays, shiftInterval, mergeIntervals, localDateOf, ON_CALL_TYPE } from './workScheduleReport.js';
import { effectiveEndMs, displayStatus } from './attendancePolicy.js';

const MIN = 60000;
const KINDS = ['verified', 'unverified', 'active'];
const mins = (ms) => Math.round(ms / MIN);
const iso = (ms) => new Date(ms).toISOString();
const hits = (a, b) => a.startMs < b.endMs && a.endMs > b.startMs;
const clip = (list, a, b) => list.map(([s, e]) => [Math.max(s, a), Math.min(e, b)]).filter(([s, e]) => e > s);
const total = (list) => mins(list.reduce((t, [s, e]) => t + e - s, 0));

// Parts of [a, b) not covered by the sorted, merged `cover` intervals.
function subtract(a, b, cover) {
  const out = [];
  let cur = a;
  for (const [s, e] of cover) {
    if (e <= cur) continue;
    if (s >= b) break;
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

// Non-voided records as non-overlapping intervals with their verification kind.
function sessionsOf(records, nowMs) {
  const out = [];
  let cursor = -Infinity;
  const sorted = records.filter((r) => r.status !== 'VOIDED').sort((a, b) => a.effective_start_at.localeCompare(b.effective_start_at));
  for (const r of sorted) {
    const s = Date.parse(r.effective_start_at), e = effectiveEndMs(r, nowMs);
    if (!e) continue;
    const shown = displayStatus(r, nowMs);
    const startMs = Math.max(s, cursor);
    if (e > startMs) out.push({ id: r.id, startMs, endMs: e, kind: shown === 'NEEDS_REVIEW' ? 'unverified' : shown === 'ACTIVE' ? 'active' : 'verified' });
    cursor = Math.max(cursor, e);
  }
  return out;
}

function compareWorker(shifts, sessions, requests, { start, end, pStart, pEnd, nowMs }) {
  const rows = [];
  for (const s of shifts) {
    const iv = shiftInterval(s), onCall = s.row_type === ON_CALL_TYPE, timed = iv.valid && !onCall;
    const inStart = s.date >= start && s.date <= end;
    if (!inStart && !(timed && iv.endMs > pStart)) continue;
    rows.push({
      id: s.id, date: s.date, row_label: s.row_label || s.row_type, start_time: s.start_time || '', end_time: s.end_time || '',
      is_on_call: onCall, overnight: !!iv.overnight, starts_before_period: !inStart, planned_minutes: timed ? iv.minutes : 0,
      state: onCall ? 'ON_CALL' : timed ? 'UPCOMING' : 'INVALID_TIMES', needs_review: !onCall && !timed, _iv: timed ? iv : null,
    });
  }
  const timed = rows.filter((r) => r._iv).sort((a, b) => a._iv.startMs - b._iv.startMs);
  let cursor = -Infinity;
  for (const row of timed) {
    const iv = row._iv, others = timed.filter((o) => o !== row);
    const touching = sessions.filter((x) => hits(x, iv));
    const from = Math.max(iv.startMs, cursor);
    cursor = Math.max(cursor, iv.endMs);
    for (const k of KINDS) row[`${k}_minutes`] = total(clip(sessions.filter((x) => x.kind === k).map((x) => [x.startMs, x.endMs]), from, iv.endMs));
    row.overlaps_other_shift = others.some((o) => hits(o._iv, iv));
    row.pending_correction = requests.some((q) => touching.some((x) => x.id === q.attendance_record_id)
      || (q.request_type === 'ADD' && q.requested_start_at && Date.parse(q.requested_start_at) < iv.endMs && Date.parse(q.requested_end_at || q.requested_start_at) >= iv.startMs));
    if (!touching.length) {
      row.state = iv.endMs <= nowMs ? 'NO_RECORD' : 'UPCOMING';
    } else {
      const first = touching[0], last = touching[touching.length - 1];
      // One continuous session across back-to-back shifts has no separate arrival / departure at the boundary.
      const fromPrev = first.startMs < iv.startMs && others.some((o) => o._iv.startMs < iv.startMs && hits(first, o._iv));
      const intoNext = last.endMs > iv.endMs && others.some((o) => o._iv.endMs > iv.endMs && hits(last, o._iv));
      row.state = 'RECORDED';
      row.sessions = touching.map((x) => ({ start_at: iso(x.startMs), end_at: x.kind === 'active' ? null : iso(x.endMs), kind: x.kind }));
      row.arrival_continuous = fromPrev;
      row.arrival_diff_minutes = fromPrev ? null : mins(first.startMs - iv.startMs);
      row.departure_continuous = intoNext;
      row.departure_kind = last.kind;
      row.departure_diff_minutes = intoNext || last.kind !== 'verified' ? null : mins(last.endMs - iv.endMs);
    }
    row.needs_review = row.state === 'NO_RECORD' || row.pending_correction || touching.some((x) => x.kind === 'unverified');
  }

  const union = mergeIntervals(timed.map((r) => [r._iv.startMs, r._iv.endMs]));
  const extra = [];
  for (const x of sessions) {
    for (const [a, b] of subtract(Math.max(x.startMs, pStart), Math.min(x.endMs, pEnd), union)) {
      if (mins(b - a) > 0) extra.push({ date: localDateOf(a), start_at: iso(a), end_at: iso(b), minutes: mins(b - a), kind: x.kind });
    }
  }
  const counted = rows.filter((r) => !r.starts_before_period);
  const extraOf = (k) => extra.filter((x) => x.kind === k).reduce((t, x) => t + x.minutes, 0);
  return {
    planned_minutes: total(clip(union, pStart, pEnd)),
    planned_to_date_minutes: total(clip(union, pStart, Math.min(pEnd, nowMs))),
    planned_shift_count: counted.filter((r) => !r.is_on_call).length,
    on_call_count: counted.filter((r) => r.is_on_call).length,
    recorded_count: counted.filter((r) => r.state === 'RECORDED').length,
    no_record_count: counted.filter((r) => r.state === 'NO_RECORD').length,
    review_count: counted.filter((r) => r.needs_review).length,
    pending_count: requests.length,
    extra_verified_minutes: extraOf('verified'), extra_unverified_minutes: extraOf('unverified'), extra_active_minutes: extraOf('active'),
    shifts: rows.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)).map(({ _iv, ...r }) => r),
    extra,
  };
}

const groupBy = (list, key) => list.reduce((m, x) => ((m[x[key]] || (m[x[key]] = [])).push(x), m), {});

// → { [worker_id]: comparison }. `requests` = open correction requests of the period (they never change totals).
export function buildComparison({ shifts, records, requests = [], start, end, nowMs }) {
  const ctx = { start, end, pStart: localToUtcMs(start), pEnd: localToUtcMs(addDays(end, 1)), nowMs };
  const byShift = groupBy(shifts.filter((s) => s.worker_id), 'worker_id'), byRec = groupBy(records, 'worker_profile_id'), byReq = groupBy(requests, 'worker_profile_id');
  const out = {};
  for (const id of new Set([...Object.keys(byShift), ...Object.keys(byRec)])) {
    out[id] = { worker_name: byShift[id]?.[0]?.worker_name || '', ...compareWorker(byShift[id] || [], sessionsOf(byRec[id] || [], nowMs), byReq[id] || [], ctx) };
  }
  return out;
}