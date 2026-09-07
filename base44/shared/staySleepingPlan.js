import { activeAllocation, nights, overlaps, pick, segments } from './stayReconciliationCore.js';
const TEMPLATE = ['operational_group_profile_id','group_id','tent_id','neighborhood_id','allocated_pax','allocation_type','gender_group','notes','status','allocation_series_id','series_effective_from_period_id'];
// Retain the historical prefix and intersect only the future tail. No past row is cancelled.
export function trimPeriodRows(rows, proposed, today) {
  const updates = [], cancels = [];
  for (const row of rows) {
    if (row.departure_date <= today) continue;
    const period = proposed.find(p => p.id === row.stay_period_id);
    const start = row.arrival_date < today ? row.arrival_date : (period ? [row.arrival_date, period.start_date].sort().at(-1) : row.departure_date);
    const end = period ? [row.departure_date, period.end_date].sort()[0] : today;
    if (start >= end) { if (row.arrival_date >= today) cancels.push({ id: row.id }); }
    else if (start !== row.arrival_date || end !== row.departure_date) updates.push({ id: row.id, arrival_date: start, departure_date: end });
  }
  return { updates, cancels };
}
export function planStaySleeping({ groupId, current, proposed, allocations, reservations, logical, tents, today }) {
  const own = allocations.filter(r => r.group_id === groupId && activeAllocation(r));
  const trim = trimPeriodRows(own, proposed, today);
  const released = new Set(trim.cancels.map(r => r.id));
  const retained = own.filter(r => !released.has(r.id)).map(r => ({ ...r, ...trim.updates.find(u => u.id === r.id) }));
  const inventory = new Map(tents.map(t => [t.id,t]));
  const creates = [], conflicts = [];
  for (const series of logical) {
    if (series.inconsistent || !series.linked) continue;
    const base = [...series.period_rows].sort((a,b) => b.departure_date.localeCompare(a.departure_date))[0];
    const marker = current.find(p => p.id === series.series_effective_from_period_id);
    for (const period of proposed) {
      if (marker && period.start_date < marker.start_date) continue;
      const old = current.find(p => p.id === period.id);
      const oldNights = new Set(old ? nights(old.start_date, old.end_date) : []);
      const added = nights(period.start_date, period.end_date).filter(d => d >= today && !oldNights.has(d));
      const safe = [];
      for (const night of added) {
        if (retained.some(r => r.tent_id === base.tent_id && r.arrival_date <= night && night < r.departure_date)) continue;
        const blockers = allocations.filter(r => r.group_id !== groupId && activeAllocation(r) && r.tent_id === base.tent_id && r.arrival_date <= night && night < r.departure_date);
        const tent = inventory.get(base.tent_id);
        if (blockers.length || !tent || tent.working_status !== 'WORKING' || Number(base.allocated_pax) > Number(tent.capacity)) {
          conflicts.push({ date: night, tent_id: base.tent_id, tent_code: tent?.code || '', missing_pax: Number(base.allocated_pax), conflicting_allocation_ids: blockers.map(r => r.id) }); continue;
        }
        // A plan can itself contain multiple series for one tent; never overlap those either.
        if (creates.some(r => r.template.tent_id === base.tent_id && r.template.arrival_date <= night && night < r.template.departure_date)) continue;
        safe.push(night);
      }
      for (const range of segments(safe)) creates.push({ period_key: period.period_key, template: { ...pick(base,TEMPLATE), ...range, housekeeping_status: 'PENDING' } });
    }
  }
  const mine = reservations.filter(r => r.group_id === groupId && r.status === 'ACTIVE');
  const resTrim = trimPeriodRows(mine, proposed, today);
  const nconflicts = [];
  for (const item of creates.filter(r => r.template.allocation_type === 'STUDENT')) {
    const r = item.template;
    const others = reservations.filter(o => o.group_id !== groupId && o.status === 'ACTIVE' && o.neighborhood_id === r.neighborhood_id && overlaps(r.arrival_date,r.departure_date,o.arrival_date,o.departure_date));
    if (others.length) nconflicts.push({ module: 'NEIGHBORHOOD', impact_type: 'SHARED_REVIEW', date: r.arrival_date, end_date: nights(r.arrival_date,r.departure_date).at(-1), summary: 'נדרש תיאום שימוש משותף בשכונה בעקבות שינוי השהייה', metadata: { neighborhood_id: r.neighborhood_id } });
  }
  return { allocationUpdates: trim.updates, allocationCancels: trim.cancels, allocationCreates: creates, reservationUpdates: resTrim.updates, reservationCancels: resTrim.cancels, reservationCreates: [], exactTentConflicts: conflicts, neighborhoodImpacts: nconflicts };
}