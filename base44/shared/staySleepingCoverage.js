import { activeAllocation, nights, todayIL } from './stayReconciliationCore.js';
// Coverage is derived, never a manually closable sleeping task. Drafts reserve tents but are not confirmed beds.
export function sleepingCoverage(group, profile, periods, allocations, tents, date = null, today = todayIL()) {
  const required = Math.max(0, Number(group.total_pax ?? profile?.total_pax ?? 0));
  const inventory = new Map(tents.map(t => [t.id, t]));
  const result = [];
  for (const period of periods.filter(p => p.status !== 'CANCELLED')) {
    const dates = date ? (period.start_date <= date && date < period.end_date ? [date] : []) : nights(period.start_date > today ? period.start_date : today, period.end_date);
    for (const night of dates) {
      if (night < today) continue;
      const occupied = allocations.filter(a => activeAllocation(a) && a.arrival_date <= night && night < a.departure_date);
      const own = occupied.filter(a => a.group_id === group.id && a.status === 'CONFIRMED');
      let covered = 0;
      for (const row of own) {
        const tent = inventory.get(row.tent_id);
        if (!tent || tent.working_status !== 'WORKING' || occupied.some(a => a.id !== row.id && a.tent_id === row.tent_id)) continue;
        covered += Math.min(Number(tent.capacity || 0), Math.max(0, Number(row.allocated_pax || 0)));
      }
      const missing = Math.max(0, required - covered);
      if (missing > 0) result.push({ date: night, stay_period_id: period.id, required_pax: required, covered_pax: covered, missing_pax: missing, summary: `${missing} משתתפים ללא מקום לינה מאושר בתאריך ${night.split('-').reverse().join('/')}` });
    }
  }
  return result;
}