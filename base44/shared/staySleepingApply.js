import { activeAllocation, nextDay, overlaps, pick, readAll, segments, todayIL } from './stayReconciliationCore.js';
import { persistImpact } from './stayReconciliationActions.js';
export async function applyTrims(db, entityName, updates, cancels) {
  const today = todayIL();
  for (const item of [...updates,...cancels.map(r => ({...r,status:'CANCELLED'}))]) {
    const row = await db[entityName].get(item.id);
    if (!row || row.status === 'CANCELLED') continue;
    const target = pick(item,['arrival_date','departure_date','status']);
    if (Object.entries(target).every(([k,v]) => row[k] === v)) continue;
    if (row.departure_date <= today || (target.status === 'CANCELLED' && row.arrival_date < today) || (row.arrival_date < today && target.arrival_date && target.arrival_date !== row.arrival_date) || (target.departure_date && target.departure_date < today)) throw new Error('שיבוץ שכבר חל נשמר ללא שינוי; נדרשת בדיקה');
    // Release/shorten only: retries never grow a tail or move a start backward.
    if (target.departure_date && target.departure_date > row.departure_date || target.arrival_date && target.arrival_date < row.arrival_date) throw new Error('השיבוץ השתנה מאז האישור');
    await db[entityName].update(row.id,target);
  }
}
export async function createSafeSleeping(db, template, periodId) {
  const today = todayIL();
  const period = await db.GroupStayPeriod.get(periodId);
  if (!period || period.status !== 'ACTIVE' || period.group_id !== template.group_id) return false;
  if (template.arrival_date < today || template.arrival_date < period.start_date || template.departure_date > period.end_date) return false;
  const rows = await readAll(db.SleepingAllocation,{tent_id:template.tent_id,status:{$in:['DRAFT','CONFIRMED']}});
  if (rows.some(r => r.group_id === template.group_id && r.arrival_date <= template.arrival_date && r.departure_date >= template.departure_date && r.allocation_type === template.allocation_type && r.gender_group === template.gender_group && Number(r.allocated_pax) === Number(template.allocated_pax))) return true;
  if (rows.some(r => overlaps(template.arrival_date,template.departure_date,r.arrival_date,r.departure_date))) return false;
  const tent = await db.Tent.get(template.tent_id);
  if (!tent || tent.working_status !== 'WORKING' || Number(template.allocated_pax) > Number(tent.capacity)) return false;
  // Coalesce a contiguous safe extension to avoid artificial housekeeping turnovers.
  const prefix = rows.find(r => r.group_id === template.group_id && r.stay_period_id === periodId && r.allocation_series_id === template.allocation_series_id && r.departure_date === template.arrival_date && r.status === template.status && Number(r.allocated_pax) === Number(template.allocated_pax));
  if (prefix) await db.SleepingAllocation.update(prefix.id,{departure_date:template.departure_date});
  else await db.SleepingAllocation.create({...template,stay_period_id:periodId});
  return true;
}
export async function reconcileNeighborhoods(db, groupId, change, email) {
  const today = todayIL();
  const [rows,reservations,periods] = await Promise.all([readAll(db.SleepingAllocation,{group_id:groupId,status:{$in:['DRAFT','CONFIRMED']}}),readAll(db.NeighborhoodReservation,{status:'ACTIVE'}),readAll(db.GroupStayPeriod,{group_id:groupId,status:'ACTIVE'})]);
  for (const row of rows.filter(r => r.allocation_type === 'STUDENT' && r.departure_date > today)) {
    const period = periods.find(p => p.id === row.stay_period_id); if (!period) continue;
    const start = [today,row.arrival_date,period.start_date].sort().at(-1), end = [row.departure_date,period.end_date].sort()[0];
    if (start >= end) continue;
    if (reservations.some(r => r.group_id === groupId && r.stay_period_id === period.id && r.neighborhood_id === row.neighborhood_id && r.arrival_date <= start && end <= r.departure_date)) continue;
    const others = reservations.filter(r => r.group_id !== groupId && r.neighborhood_id === row.neighborhood_id && overlaps(start,end,r.arrival_date,r.departure_date));
    const own = reservations.filter(r => r.group_id === groupId && r.neighborhood_id === row.neighborhood_id);
    const approval = own.find(r => r.shared_neighborhood_allowed && r.shared_neighborhood_reason);
    if (others.length && !approval) {
      await persistImpact(db,change,{key:`NEIGHBORHOOD:${period.id}:${row.neighborhood_id}:${start}`,module:'NEIGHBORHOOD',impact_type:'SHARED_REVIEW',date:start,end_date:end,summary:'נדרש תיאום שימוש משותף בשכונה; תאריכי השהייה נשמרו',metadata:{neighborhood_id:row.neighborhood_id}},email); continue;
    }
    const existing = own.find(r => r.stay_period_id === period.id && r.arrival_date <= end && start <= r.departure_date);
    const data = {group_id:groupId,operational_group_profile_id:row.operational_group_profile_id,stay_period_id:period.id,neighborhood_id:row.neighborhood_id,arrival_date:existing ? [existing.arrival_date,start].sort()[0] : start,departure_date:existing ? [existing.departure_date,end].sort().at(-1) : end,gender_group:'MIXED',planned_tents:new Set(rows.filter(r => r.neighborhood_id === row.neighborhood_id && r.stay_period_id === period.id).map(r => r.tent_id)).size,status:'ACTIVE',source:'allocation',...(approval ? pick(approval,['shared_neighborhood_allowed','shared_neighborhood_reason','shared_neighborhood_approved_by','shared_neighborhood_approved_at']) : {})};
    if (existing) { const updated = await db.NeighborhoodReservation.update(existing.id,data); Object.assign(existing,updated); }
    else reservations.push(await db.NeighborhoodReservation.create(data));
  }
}