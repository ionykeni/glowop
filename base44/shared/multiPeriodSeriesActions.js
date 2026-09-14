import { liveSleeping, overlapSleeping } from './sleepingActionCore.js';
import { validateSleepingAssignments } from './multiPeriodSleepingPlan.js';
import { validateLinkedSeriesCompleteness } from './logicalSleepingSeries.js';
import { syncSleepingNeighborhoods } from './sleepingNeighborhoodSync.js';
export function planSeriesAction(ctx, body) {
  const {group,periods,rows,tents,neighborhoods,reservations,today}=ctx;
  const {action,allocation_series_id,destination_tent_id,effective_period_id,effective_date}=body;
  if (!['release_series','release_all','reassign_series'].includes(action)) throw new Error('פעולת שיבוץ לא מוכרת');
  if (body.scope && body.scope!=='FROM_EFFECTIVE_FORWARD') throw new Error('היקף השינוי אינו נתמך');
  if(action!=='release_all'&&!allocation_series_id) throw new Error('חסרה זהות סדרת השיבוץ');
  const mine=rows.filter(r=>r.group_id===group.id);
  const source=mine.filter(r=>action==='release_all'||r.allocation_series_id===allocation_series_id);
  if(action!=='release_all'&&!source.length) throw new Error('סדרת השיבוץ לא נמצאה');
  let effective=today;
  if(action==='reassign_series') {
    const p=effective_period_id?periods.find(p=>p.id===effective_period_id):null;
    if(effective_period_id&&!p) throw new Error('תקופת השהייה לא נמצאה בקבוצה');
    effective=effective_date||(p?p.start_date:null);
    if(!effective||!/^\d{4}-\d{2}-\d{2}$/.test(effective)||Number.isNaN(Date.parse(`${effective}T12:00:00Z`))||effective<today) throw new Error('יש לבחור תאריך שינוי מהיום והלאה');
    if(p&&!(p.start_date<=effective&&effective<p.end_date)) throw new Error('התאריך אינו בתוך התקופה שנבחרה');
  }
  const selected=source.filter(r=>liveSleeping(r)&&r.departure_date>today&&r.departure_date>effective);
  const updates=[],creates=[],warnings=[];
  if(action!=='reassign_series') {
    for(const row of selected) {
      updates.push({
        row,
        data: row.arrival_date < today
          ? { departure_date:today, segment_end_date:today, series_action:'RELEASE', series_action_date:today }
          : { status:'CANCELLED', series_action:'RELEASE', series_action_date:today },
      });
    }
  }
  else {
    const destination=tents.find(t=>t.id===destination_tent_id);if(!destination) throw new Error('אוהל היעד לא נמצא');
    // A retry finds the retained cancellation records, not a new source assignment.
    if(!selected.length) { const old=source.filter(r=>r.series_action==='REASSIGN'&&r.series_action_date===effective);const replacements=mine.filter(r=>old.some(o=>o.replacement_series_id===r.allocation_series_id));if(replacements.length&&replacements.every(r=>r.tent_id===destination.id)) return {updates,creates,warnings,already_applied:true};throw new Error('אין שורות לשינוי בטווח שנבחר'); }
    if(selected.some(r=>r.tent_id===destination.id)) throw new Error('יש לבחור אוהל יעד שונה');
    const series=crypto.randomUUID(),first=selected.slice().sort((a,b)=>a.arrival_date.localeCompare(b.arrival_date))[0];
    for(const row of selected) {
      const arrival=row.arrival_date<effective?effective:row.arrival_date;
      const clean={operational_group_profile_id:row.operational_group_profile_id,group_id:group.id,tent_id:destination.id,neighborhood_id:destination.neighborhood_id,stay_period_id:row.stay_period_id,allocation_series_id:series,series_effective_from_period_id:first.stay_period_id,arrival_date:arrival,departure_date:row.departure_date,allocated_pax:row.allocated_pax,allocation_type:row.allocation_type,gender_group:row.gender_group,status:row.status,housekeeping_status:'PENDING',notes:row.notes||'',source_allocation_id:row.id,...(arrival!==periods.find(p=>p.id===row.stay_period_id)?.start_date?{segment_start_date:arrival}:{})};
      if(validateSleepingAssignments([clean],tents,neighborhoods).length) throw new Error('אוהל היעד אינו מתאים לסוג השיבוץ או לכמות האנשים');
      if(rows.some(other=>liveSleeping(other)&&other.tent_id===destination.id&&overlapSleeping(clean,other))) throw new Error('אוהל היעד תפוס בתאריכים שנבחרו');
      warnings.push(...reservations.filter(r=>r.group_id!==group.id&&r.neighborhood_id===destination.neighborhood_id&&overlapSleeping(clean,r)).map(r=>({code:'SHARED_NEIGHBORHOOD',neighborhood_id:r.neighborhood_id,arrival_date:clean.arrival_date,departure_date:clean.departure_date})));
      creates.push(clean);
      const meta={series_action:'REASSIGN',series_action_date:effective,replacement_series_id:series};
      updates.push({row,data:row.arrival_date<effective?{...meta,departure_date:effective,segment_end_date:effective}:{...meta,status:'CANCELLED'}});
    }
    const projected=mine.map(r=>({...r,...updates.find(u=>u.row.id===r.id)?.data})).concat(creates.map((r,i)=>({...r,id:`projected-${i}`})));
    if(!validateLinkedSeriesCompleteness(projected,periods,group.id,today).valid) throw new Error('השינוי המבוקש אינו שומר על רציפות הסדרות');
  }
  return {updates,creates,warnings,affected_reservations:action==='release_all'?reservations.filter(r=>r.group_id===group.id&&r.departure_date>today):[],already_applied:updates.length===0};
}
export async function applySeriesAction(db,writes,ctx,plan) {
  // Create destination before releasing source: failures never silently lose source capacity.
  for(const row of plan.creates) await writes.create('SleepingAllocation',row);
  for(const item of plan.updates) {
    if(item.row.departure_date<=ctx.today) throw new Error('אין לשנות שיבוץ היסטורי');
    await writes.update('SleepingAllocation',item.row,item.data);
  }
  const affected=[...plan.updates.map(u=>u.row),...plan.creates,...(plan.affected_reservations||[])];
  await syncSleepingNeighborhoods(db,writes,ctx.group.id,affected,ctx.today);
}