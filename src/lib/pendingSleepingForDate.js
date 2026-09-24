// Read-only badge: operational presence is determined elsewhere, never by allocations.
export function pendingSleepingForDate(group, profile, periods, allocations, date) {
  if (group.group_type !== 'LODGING' || !profile?.is_sleeping_group || !profile?.sleeping_requirements_completed) return false;
  const period = group.stay_mode === 'MULTI_PERIOD'
    ? periods.find(p => p.status === 'ACTIVE' && p.start_date <= date && date < p.end_date)
    : { start_date: group.arrival_date, end_date: group.departure_date };
  if (!period) return false;
  const rows = allocations.filter(r => r.group_id === group.id && r.status === 'CONFIRMED' && (group.stay_mode !== 'MULTI_PERIOD' || r.stay_period_id === period.id));
  const active = rows.filter(r => r.arrival_date <= date && date < r.departure_date);
  const marker = r => String(r.notes || '').match(/__vip_req_\d+__|__alt_tent__/i)?.[0] || '';
  const split = Number(profile.boys_beds_needed ?? profile.boys_count ?? 0) + Number(profile.girls_beds_needed ?? profile.girls_count ?? 0) > 0;
  const genders = split ? ['BOYS','GIRLS'] : ['MIXED'];
  if (genders.some(g => {
    const baseline = split ? Number(g === 'BOYS' ? (profile.boys_beds_needed ?? profile.boys_count ?? 0) : (profile.girls_beds_needed ?? profile.girls_count ?? 0)) : Number(profile.participant_count || 0);
    const laterDates = [...new Set(rows.filter(r => r.arrival_date >= date && r.arrival_date < period.end_date).map(r => r.arrival_date))];
    const laterCount = Math.max(0, ...laterDates.map(d => rows.filter(r => r.arrival_date <= d && d < r.departure_date && r.allocation_type === 'STUDENT' && !marker(r) && r.gender_group === g).reduce((sum,r) => sum + Number(r.allocated_pax || 0), 0)));
    const now = active.filter(r => r.allocation_type === 'STUDENT' && !marker(r) && r.gender_group === g).reduce((sum,r) => sum + Number(r.allocated_pax || 0), 0);
    return now < Math.max(baseline, laterCount);
  })) return true;
  let vip = []; try { vip = JSON.parse(profile.vip_tent_requirements_json || '[]'); } catch { /* none */ }
  if (vip.some((r,i) => active.filter(a => marker(a) === `__vip_req_${i}__`).reduce((sum,a) => sum + Number(a.allocated_pax || 0),0) < Number(r.people_count || 0))) return true;
  return active.filter(r => marker(r) === '__alt_tent__').reduce((sum,r) => sum + Number(r.allocated_pax || 0),0) < Number(profile.staff_alt_tent_pax || 0);
}