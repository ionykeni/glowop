import { liveSleeping, overlapSleeping } from './sleepingActionCore.js';

// Rows created for THIS stay period whose dates no longer match the edited period.
// Intentional segments (reassignment/release/partial start) are never treated as stale.
export function staleRowsForPeriod(rows, groupId, period, today) {
  return rows.filter(r => r.group_id === groupId && r.stay_period_id === period.id && liveSleeping(r) && r.departure_date > today
    && !r.segment_start_date && !r.segment_end_date && !r.series_action
    && (r.arrival_date !== period.start_date || r.departure_date !== period.end_date));
}

// Reconcile the same tents/pax/gender/marker rows to the updated period dates, [start,end).
// Elapsed nights stay untouched: a started row keeps its arrival and only its future end moves.
export function planApplyToUpdatedDates(ctx, periodId) {
  const { group, periods, rows, tents, reservations, today } = ctx;
  const period = periods.find(p => p.id === periodId);
  if (!period || period.end_date <= today) throw new Error('יש לבחור תקופה נוכחית או עתידית');
  const stale = staleRowsForPeriod(rows, group.id, period, today);
  if (!stale.length) return null;
  if (new Set(stale.map(r => r.tent_id)).size !== stale.length) throw new Error('נמצא אוהל כפול בשיבוץ הקיים; נדרשת בדיקה');
  const firstNight = period.start_date < today ? today : period.start_date;
  const updates = stale.map(row => {
    const start = row.arrival_date < today ? row.arrival_date : firstNight;
    const data = { arrival_date: start, departure_date: period.end_date, ...(start !== period.start_date ? { segment_start_date: start } : {}) };
    const tent = tents.find(t => t.id === row.tent_id);
    return { row, data, tent_code: tent?.code || row.tent_id, allocated_pax: Number(row.allocated_pax), allocation_type: row.allocation_type, gender_group: row.gender_group, notes: row.notes || '', old_arrival_date: row.arrival_date, old_departure_date: row.departure_date };
  });
  const blocked = [];
  for (const u of updates) {
    const next = { ...u.row, ...u.data };
    const clash = rows.filter(o => o.id !== u.row.id && liveSleeping(o) && o.tent_id === u.row.tent_id && overlapSleeping(next, o));
    if (clash.length) blocked.push({ tent_code: u.tent_code, conflicts: clash.map(o => ({ group_id: o.group_id, arrival_date: o.arrival_date, departure_date: o.departure_date })) });
  }
  const warnings = [...new Set(updates.filter(u => u.allocation_type === 'STUDENT').filter(u => reservations.some(n => n.group_id !== group.id && n.status === 'ACTIVE' && n.neighborhood_id === u.row.neighborhood_id && overlapSleeping(n, { ...u.row, ...u.data }))).map(u => u.row.neighborhood_id))];
  return {
    mode: 'UPDATE_DATES', updates, blocked, warnings,
    old_period: { start_date: stale.map(r => r.arrival_date).sort()[0], end_date: stale.map(r => r.departure_date).sort().at(-1) },
    target_period: { start_date: period.start_date, end_date: period.end_date },
    proposal_keys: updates.map(u => `${u.row.id}:${u.row.updated_date}:${u.data.arrival_date}:${u.data.departure_date}`).sort(),
  };
}