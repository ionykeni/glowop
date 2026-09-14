import { liveSleeping, overlapSleeping, readSleepingRows } from './sleepingActionCore.js';
// Recompute only the explicitly affected period/neighborhood pairs, never historical reservations.
export async function syncSleepingNeighborhoods(db, writes, groupId, affected, today) {
  const [rows, reservations] = await Promise.all([readSleepingRows(db.SleepingAllocation, { group_id: groupId }), readSleepingRows(db.NeighborhoodReservation, { group_id: groupId, status: 'ACTIVE' })]);
  const pairs = new Map(affected.filter(r => r.departure_date > today).map(r => [`${r.stay_period_id}:${r.neighborhood_id}`, r]));
  for (const sample of pairs.values()) {
    const own = reservations.filter(r => r.departure_date > today && r.stay_period_id === sample.stay_period_id && r.neighborhood_id === sample.neighborhood_id);
    const occupants = rows.filter(r => liveSleeping(r) && r.departure_date > today && r.allocation_type === 'STUDENT' && r.stay_period_id === sample.stay_period_id && r.neighborhood_id === sample.neighborhood_id);
    if (!occupants.length) {
      for (const row of own) await writes.update('NeighborhoodReservation', row, row.arrival_date < today
        ? { departure_date: today }
        : { status: 'CANCELLED' });
      continue;
    }
    const starts = occupants.map(r => r.arrival_date).sort(), ends = occupants.map(r => r.departure_date).sort();
    const genders = [...new Set(occupants.map(r => r.gender_group))];
    const data = { group_id: groupId, operational_group_profile_id: sample.operational_group_profile_id, stay_period_id: sample.stay_period_id, neighborhood_id: sample.neighborhood_id, arrival_date: starts[0], departure_date: ends.at(-1), planned_tents: new Set(occupants.map(r => r.tent_id)).size, gender_group: genders.length === 1 ? genders[0] : 'MIXED', status: 'ACTIVE', source: 'allocation' };
    if (own[0]) { if (Object.entries(data).some(([k,v]) => own[0][k] !== v)) await writes.update('NeighborhoodReservation', own[0], data); for (const duplicate of own.slice(1)) await writes.update('NeighborhoodReservation', duplicate, { status: 'CANCELLED' }); }
    else await writes.create('NeighborhoodReservation', data);
  }
}