import { localDateOf, localToUtcMs, weekStartOf } from './workScheduleReport.js';
import { inContext, inMonth, instant, iso, localDayPieces, validDate } from './payrollHoursCalendar.js';

export const emptyHours = () => ({ verified: 0, active: 0, unverified: 0, pending: 0 });
const priority = { verified: 0, pending: 1, unverified: 2, active: 3 };
export const isOpenRequest = (r) => ['PENDING', 'APPROVING'].includes(r.status);
const dateOf = (at) => Number.isFinite(at) ? localDateOf(at) : null;
const stamp = (at) => Number.isFinite(at) ? iso(at) : null;

function session(r, now, pending) {
  const start = instant(r.effective_start_at), due = instant(r.auto_close_due_at);
  const open = r.status === 'ACTIVE', expired = open && due <= now;
  const recordedEnd = open ? (expired ? due : NaN) : instant(r.effective_end_at);
  const end = open ? Math.min(now, due) : recordedEnd;
  const invalid = !Number.isFinite(start) || !(end > start) || end > now + 60_000;
  const verified = r.status === 'CLOSED' && !r.needs_review && !invalid;
  const kind = pending ? 'pending' : (verified ? 'verified' : open && !expired && !r.needs_review && !invalid ? 'active' : 'unverified');
  return {
    start, end: invalid ? NaN : end, anchor: dateOf(start) || (validDate(r.local_date) ? r.local_date : null),
    row: { id: r.id, kind, start_at: stamp(start), end_at: stamp(recordedEnd), session_ms: invalid ? null : end - start,
      estimated_end: expired || r.status === 'AUTO_CLOSED', invalid, corrected: !!r.is_corrected, overlap: false, counted_ms: invalid ? null : 0 },
  };
}

function countOnce(slices, day) {
  const events = slices.flatMap((p) => [{ at: p.start, p, on: true }, { at: p.end, p, on: false }]).sort((a, b) => a.at - b.at);
  const active = new Set();
  let prev = events[0]?.at;
  for (const event of events) {
    if (event.at > prev && active.size) {
      if (active.size > 1) {
        day.review = true;
        for (const p of active) p.row.overlap = true;
      }
      let winner;
      for (const p of active) if (!winner || priority[p.row.kind] < priority[winner.row.kind]
        || (p.row.kind === winner.row.kind && p.order < winner.order)) winner = p;
      const ms = event.at - prev;
      winner.row.counted_ms += ms;
      day.hours[winner.row.kind] += ms;
      if (winner.row.kind === 'verified') day.verified.push({ start: prev, end: event.at });
    }
    if (event.on) active.add(event.p); else active.delete(event.p);
    prev = event.at;
  }
}

export function buildPayrollDays(records, requests, range, now) {
  const days = new Map(), byRecord = new Map();
  const getDay = (date) => {
    if (!days.has(date)) days.set(date, { date, hours: emptyHours(), rows: [], slices: [], verified: [], review: false, overnight: false });
    return days.get(date);
  };
  const open = requests.filter(isOpenRequest);
  const targets = new Set(open.flatMap((r) => [r.attendance_record_id, r.applied_record_id]).filter(Boolean));
  const keys = new Set(open.filter((r) => r.status === 'APPROVING' && r.decision_key).map((r) => `APPROVE|${r.decision_key}`));
  const ordered = [...records].sort((a, b) => String(a.effective_start_at).localeCompare(String(b.effective_start_at)) || a.id.localeCompare(b.id));
  for (const [order, r] of ordered.entries()) {
    const dates = [];
    byRecord.set(r.id, dates);
    if (r.status === 'VOIDED') continue;
    const { start, end, anchor, row } = session(r, now, targets.has(r.id) || keys.has(r.manual_request_id));
    if (row.invalid) {
      if (inContext(anchor, range)) {
        const day = getDay(anchor);
        day.rows.push(row);
        day.review = true;
        dates.push(anchor);
      }
      continue;
    }
    const overnight = dateOf(start) !== dateOf(end - 1);
    for (const p of localDayPieces(Math.max(start, range.lower), Math.min(end, range.upper))) {
      const day = getDay(p.date);
      const rowPart = { ...row, day_ms: p.end - p.start };
      day.rows.push(rowPart);
      day.slices.push({ ...p, row: rowPart, order });
      day.overnight ||= overnight;
      day.review ||= row.kind !== 'verified';
      dates.push(p.date);
    }
  }
  const pending = [];
  for (const r of open) {
    const dates = new Set([...(byRecord.get(r.attendance_record_id) || []), r.local_date].filter((d) => validDate(d) && inContext(d, range)));
    for (const prefix of ['original', 'requested']) {
      const start = instant(r[`${prefix}_start_at`]), end = instant(r[`${prefix}_end_at`]);
      const anchor = dateOf(start);
      if (inContext(anchor, range)) dates.add(anchor);
      for (const p of localDayPieces(Math.max(start, range.lower), Math.min(end, range.upper))) dates.add(p.date);
    }
    for (const date of dates) getDay(date).review = true;
    const displayDate = [...dates].filter((date) => inMonth(date, range)).sort()[0];
    if (displayDate) pending.push({ id: r.id, date: displayDate, type: r.request_type, status: r.status,
      start_at: stamp(instant(r.requested_start_at)), end_at: stamp(instant(r.requested_end_at)) });
  }
  const weeks = new Map();
  for (const day of [...days.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    countOnce(day.slices, day);
    const week = weekStartOf(day.date);
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(day);
  }
  return { weeks, pending: pending.sort((a, b) => a.date.localeCompare(b.date)) };
}