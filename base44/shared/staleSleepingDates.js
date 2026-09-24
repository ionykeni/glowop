import { liveSleeping, overlapSleeping } from './sleepingActionCore.js';
import { nights } from './stayReconciliationCore.js';

// Rows created for THIS stay period whose dates no longer match the (persisted or proposed) period.
// Intentional segments (reassignment/release/partial start) are never treated as stale.
export function staleRowsForPeriod(rows, groupId, period, today) {
  return rows.filter(r => r.group_id === groupId && r.stay_period_id === period.id && liveSleeping(r) && r.departure_date > today
    && !r.segment_start_date && !r.segment_end_date && !r.series_action
    && (r.arrival_date !== period.start_date || r.departure_date !== period.end_date));
}

// Exact same-tent overlap against the projected rows ([start,end) semantics). Own updated rows are projected too.
function tentClashes(rows, updates, ignoreIds = new Set()) {
  const moved = new Map(updates.map(u => [u.row.id, { ...u.row, ...u.data }]));
  const projected = rows.filter(r => liveSleeping(r) && !ignoreIds.has(r.id)).map(r => moved.get(r.id) || r);
  const blocked = [];
  for (const u of updates) {
    const next = moved.get(u.row.id);
    const clash = projected.filter(o => o.id !== u.row.id && o.tent_id === u.row.tent_id && overlapSleeping(next, o));
    if (clash.length) blocked.push({ tent_code: u.tent_code, conflicts: clash.map(o => ({ group_id: o.group_id, arrival_date: o.arrival_date, departure_date: o.departure_date })) });
  }
  return blocked;
}

// Pure: reconcile the same tents/pax/gender/marker rows to the given period dates, [start,end).
// Elapsed nights stay untouched: a started row keeps its arrival and only its future end moves.
export function planDatesForPeriod(ctx, period) {
  const { group, rows, tents, reservations, today } = ctx;
  if (!period?.id || period.end_date <= today) return null;
  const stale = staleRowsForPeriod(rows, group.id, period, today);
  if (!stale.length) return null;
  if (new Set(stale.map(r => r.tent_id)).size !== stale.length) throw new Error('נמצא אוהל כפול בשיבוץ הקיים; נדרשת בדיקה');
  const firstNight = period.start_date < today ? today : period.start_date;
  const updates = stale.map(row => {
    const start = row.arrival_date < today ? row.arrival_date : firstNight;
    const data = { arrival_date: start, departure_date: period.end_date, ...(start !== period.start_date ? { segment_start_date: start } : {}) };
    const tent = tents.find(t => t.id === row.tent_id);
    const old = new Set(nights(row.arrival_date, row.departure_date));
    const claimed_nights = nights(start, period.end_date).filter(d => d >= today && !old.has(d));
    return { row, data, claimed_nights, tent_code: tent?.code || row.tent_id, allocated_pax: Number(row.allocated_pax), allocation_type: row.allocation_type, gender_group: row.gender_group, notes: row.notes || '', old_arrival_date: row.arrival_date, old_departure_date: row.departure_date };
  });
  const warnings = [...new Set(updates.filter(u => u.allocation_type === 'STUDENT').filter(u => reservations.some(n => n.group_id !== group.id && n.status === 'ACTIVE' && n.neighborhood_id === u.row.neighborhood_id && overlapSleeping(n, { ...u.row, ...u.data }))).map(u => u.row.neighborhood_id))];
  return {
    mode: 'UPDATE_DATES', period_id: period.id, updates, blocked: tentClashes(rows, updates), warnings,
    old_period: { start_date: stale.map(r => r.arrival_date).sort()[0], end_date: stale.map(r => r.departure_date).sort().at(-1) },
    target_period: { start_date: period.start_date, end_date: period.end_date },
    proposal_keys: updates.map(u => `${u.row.id}:${u.row.updated_date}:${u.data.arrival_date}:${u.data.departure_date}`).sort(),
  };
}

export function planApplyToUpdatedDates(ctx, periodId) {
  const period = ctx.periods.find(p => p.id === periodId);
  if (!period || period.end_date <= ctx.today) throw new Error('יש לבחור תקופה נוכחית או עתידית');
  return planDatesForPeriod(ctx, period);
}

// "Keep the same sleeping" decision for a whole (proposed) period set. Pure; no writes.
export function planSleepingDecision(ctx, periods) {
  const kept = periods.filter(p => p.id);
  const keptIds = new Set(kept.map(p => p.id));
  const plans = [], errors = [];
  for (const period of kept) {
    try { const plan = planDatesForPeriod(ctx, period); if (plan) plans.push(plan); }
    catch (error) { errors.push({ tent_code: '', message: error.message, period_id: period.id }); }
  }
  const updates = plans.flatMap(p => p.updates);
  // Own rows of periods being removed will be released, so they never block the kept dates.
  const released = new Set(ctx.rows.filter(r => r.group_id === ctx.group.id && r.stay_period_id && !keptIds.has(r.stay_period_id) && r.arrival_date >= ctx.today).map(r => r.id));
  const blocked = [...errors, ...tentClashes(ctx.rows, updates, released)];
  return { plans, updates, blocked, warnings: [...new Set(plans.flatMap(p => p.warnings))], required: updates.some(u => u.claimed_nights.length > 0) };
}

export function publicSleepingDecision(decision, changedPeriodIds) {
  const claiming = decision.plans.filter(p => p.updates.some(u => u.claimed_nights.length));
  return {
    required: decision.required,
    mode: claiming.some(p => changedPeriodIds.has(p.period_id)) ? 'CHANGE' : 'REPAIR',
    blocked: decision.blocked,
    warnings: decision.warnings,
    periods: claiming.map(p => ({
      period_id: p.period_id, old_period: p.old_period, target_period: p.target_period,
      rows: p.updates.map(u => ({ allocation_id: u.row.id, tent_code: u.tent_code, allocated_pax: u.allocated_pax, allocation_type: u.allocation_type, gender_group: u.gender_group, is_vip: /__vip_req_\d+__/i.test(u.notes), is_alt_tent: /__alt_tent__/i.test(u.notes), old_arrival_date: u.old_arrival_date, old_departure_date: u.old_departure_date, new_arrival_date: u.data.arrival_date, new_departure_date: u.data.departure_date, claimed_nights: u.claimed_nights })),
    })),
  };
}