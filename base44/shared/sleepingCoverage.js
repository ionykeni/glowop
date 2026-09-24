// A night is covered only by CONFIRMED physical rows; dates are [arrival, departure).
const marker = row => String(row.notes || '').match(/__vip_req_\d+__|__alt_tent__/i)?.[0] || '';
const student = row => row.allocation_type === 'STUDENT' && !marker(row);
const nightRows = (rows, date) => rows.filter(r => r.status === 'CONFIRMED' && r.arrival_date <= date && date < r.departure_date);
const required = (profile, rows) => {
  const split = Number(profile?.boys_beds_needed ?? profile?.boys_count ?? 0) + Number(profile?.girls_beds_needed ?? profile?.girls_count ?? 0) > 0;
  const genders = split ? ['BOYS', 'GIRLS'] : ['MIXED'];
  const needs = Object.fromEntries(genders.map(g => [g, split ? Number(g === 'BOYS' ? (profile?.boys_beds_needed ?? profile?.boys_count ?? 0) : (profile?.girls_beds_needed ?? profile?.girls_count ?? 0)) : Number(profile?.participant_count || 0)]));
  for (const g of genders) needs[g] = Math.max(needs[g], ...rows.map(day => day.filter(r => student(r) && r.gender_group === g).reduce((sum, r) => sum + Number(r.allocated_pax || 0), 0)));
  let vip = []; try { vip = JSON.parse(profile?.vip_tent_requirements_json || '[]'); } catch { /* no requirements recorded */ }
  const vipNeeds = vip.map((v, i) => ({ marker: `__vip_req_${i}__`, pax: Number(v.people_count || 0) }));
  const alt = Math.max(Number(profile?.staff_alt_tent_pax || 0), ...rows.map(day => day.filter(r => marker(r) === '__alt_tent__').reduce((sum, r) => sum + Number(r.allocated_pax || 0), 0)));
  return { needs, vipNeeds, alt };
};
export function missingSleepingNights(period, rows, profile, today) {
  if (!period || period.end_date <= today) return [];
  const mine = rows.filter(r => r.stay_period_id === period.id && r.status === 'CONFIRMED');
  const dates = new Set([period.start_date < today ? today : period.start_date]);
  mine.forEach(r => { if (r.arrival_date > period.start_date && r.arrival_date < period.end_date) dates.add(r.arrival_date); if (r.departure_date > period.start_date && r.departure_date < period.end_date) dates.add(r.departure_date); });
  const samples = [...dates].sort().map(date => ({ date, rows: nightRows(mine, date) }));
  const target = required(profile, samples.map(s => s.rows));
  return samples.filter(({ rows: day }) => Object.entries(target.needs).some(([g, count]) => day.filter(r => student(r) && r.gender_group === g).reduce((sum, r) => sum + Number(r.allocated_pax || 0), 0) < count) || target.vipNeeds.some(v => day.filter(r => marker(r) === v.marker).reduce((sum, r) => sum + Number(r.allocated_pax || 0), 0) < v.pax) || day.filter(r => marker(r) === '__alt_tent__').reduce((sum, r) => sum + Number(r.allocated_pax || 0), 0) < target.alt).map(s => s.date);
}