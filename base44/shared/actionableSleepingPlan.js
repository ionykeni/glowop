import { buildMultiPeriodSleepingPlan, validateSleepingAssignments, normalizeSharedNeighborhoodIntent, addSleepingPlanConflicts } from './multiPeriodSleepingPlan.js';
import { validateLinkedSeriesCompleteness } from './logicalSleepingSeries.js';
import { sleepingToday, liveSleeping, readSleepingRows, overlapSleeping } from './sleepingActionCore.js';
export async function loadSleepingContext(db, groupId) {
  const [group, profiles, periods, tents, neighborhoods, rows, reservations] = await Promise.all([db.Group.get(groupId), readSleepingRows(db.OperationalGroupProfile,{group_id:groupId}), readSleepingRows(db.GroupStayPeriod,{group_id:groupId,status:'ACTIVE'}), readSleepingRows(db.Tent), readSleepingRows(db.Neighborhood), readSleepingRows(db.SleepingAllocation), readSleepingRows(db.NeighborhoodReservation,{status:'ACTIVE'})]);
  if (!group || group.stay_mode !== 'MULTI_PERIOD' || group.operationally_active !== true || group.status !== 'CONFIRMED') throw new Error('נדרשת קבוצה רב־תקופתית מאושרת ופעילה');
  if (profiles.length !== 1) throw new Error('יש לבדוק את הפרופיל התפעולי של הקבוצה');
  return { group, profile:profiles[0], periods:periods.sort((a,b)=>a.start_date.localeCompare(b.start_date)), tents, neighborhoods, rows, reservations, today:sleepingToday() };
}
export function prepareActionableSleepingPlan(ctx, assignments, sharedNeighborhoods) {
  const { group, profile, periods, tents, neighborhoods, rows, reservations, today } = ctx;
  if (!Array.isArray(assignments) || !assignments.length) throw new Error('יש לבחור לפחות שיבוץ אחד');
  const mine = rows.filter(r=>r.group_id===group.id);
  const validation = validateLinkedSeriesCompleteness(mine, periods, group.id);
  if (!validation.valid) throw new Error('השיבוץ הקיים אינו עקבי; נדרשת בדיקה לפני שינוי');
  const live = mine.filter(r=>liveSleeping(r)&&r.departure_date>today);
  const used = new Set(), plannedRows = [], updates = [];
  const newSeries = new Map();
  assignments.forEach((assignment,index)=>{
    const errors = validateSleepingAssignments([assignment],tents,neighborhoods);
    if (errors.length) throw new Error('יש לבדוק קיבולת, מגדר וזמינות של האוהל שנבחר');
    const candidates = live.filter(r=>assignment.allocation_series_id ? r.allocation_series_id===assignment.allocation_series_id : r.tent_id===assignment.tent_id);
    const ids = [...new Set(candidates.map(r=>r.allocation_series_id))];
    if (ids.length>1 || candidates.some(r=>!r.allocation_series_id||!r.stay_period_id)) throw new Error('לא ניתן לזהות סדרת שיבוץ יחידה');
    if (assignment.allocation_series_id && !candidates.length) throw new Error('השיבוץ השתנה; יש לרענן לפני שמירה');
    if (candidates.length) {
      if (used.has(ids[0])) throw new Error('אותה סדרת שיבוץ נשלחה פעמיים'); used.add(ids[0]);
      for (const row of candidates) {
        if (['tent_id','neighborhood_id','allocation_type','gender_group'].some(k=>row[k]!==assignment[k]) || (row.notes||'')!==(assignment.notes||'')) throw new Error('שינוי מקום דורש פעולת העברה מתוארכת; ניתן לערוך כאן כמות בלבד');
        if (Number(row.allocated_pax)!==Number(assignment.allocated_pax)) updates.push({ row, data:{allocated_pax:Number(assignment.allocated_pax)} });
        plannedRows.push({ plan_key:`existing:${row.id}`, source_stay_period_id:row.stay_period_id, logical_assignment_index:index, existing_id:row.id, sleeping_allocation:{...row,allocated_pax:Number(assignment.allocated_pax)} });
      }
    } else {
      const first = periods.find(p=>p.end_date>today); if (!first) throw new Error('אין תקופות לינה נוכחיות או עתידיות');
      const built = buildMultiPeriodSleepingPlan({groupId:group.id,profileId:profile.id,periods,assignments:[assignment],assignmentEffectivePeriodIds:[first.id]});
      if (!built.valid) throw new Error('תקופות השהייה אינן תקינות');
      const series = crypto.randomUUID(); newSeries.set(index,series);
      for (const item of built.planned_rows) {
        const arrival = item.sleeping_allocation.arrival_date < today ? today : item.sleeping_allocation.arrival_date;
        plannedRows.push({...item,plan_key:`new:${index}:${item.source_stay_period_id}`,logical_assignment_index:index,sleeping_allocation:{...item.sleeping_allocation,arrival_date:arrival,...(arrival!==item.sleeping_allocation.arrival_date?{segment_start_date:arrival}:{}),stay_period_id:item.source_stay_period_id,allocation_series_id:series}});
      }
    }
  });
  if (live.some(r=>!used.has(r.allocation_series_id))) throw new Error('אין להסיר שיבוץ קיים באמצעות שמירה; יש להשתמש בשחרור האוהל');
  const byPair = new Map();
  for (const item of plannedRows.filter(p=>p.sleeping_allocation.allocation_type==='STUDENT')) { const r=item.sleeping_allocation,key=`${item.source_stay_period_id}:${r.neighborhood_id}`; if(!byPair.has(key)) byPair.set(key,[]); byPair.get(key).push(item); }
  const intervals=[...byPair.entries()].map(([key,items])=>{const r=items[0].sleeping_allocation,genders=[...new Set(items.map(i=>i.sleeping_allocation.gender_group))];return {plan_key:key,source_stay_period_id:items[0].source_stay_period_id,neighborhood_reservation:{group_id:group.id,operational_group_profile_id:profile.id,stay_period_id:items[0].source_stay_period_id,neighborhood_id:r.neighborhood_id,arrival_date:items.map(i=>i.sleeping_allocation.arrival_date).sort()[0],departure_date:items.map(i=>i.sleeping_allocation.departure_date).sort().at(-1),gender_group:genders.length===1?genders[0]:'MIXED',planned_tents:new Set(items.map(i=>i.sleeping_allocation.tent_id)).size,status:'ACTIVE',source:'allocation'}};});
  const intent=normalizeSharedNeighborhoodIntent(sharedNeighborhoods,assignments);if(intent.errors.length) throw new Error('שימוש משותף בשכונה מחייב אישור וסיבה');
  const shared=[...intent.sharedNeighborhoodIds,...reservations.filter(r=>r.group_id===group.id&&r.shared_neighborhood_allowed).map(r=>r.neighborhood_id)];
  const plan={valid:true,errors:[],planned_rows:plannedRows,planned_neighborhood_intervals:intervals,same_tent_preserved:true};
  const result=addSleepingPlanConflicts({plan,existingAllocations:rows.filter(liveSleeping),existingNeighborhoodReservations:reservations,sharedNeighborhoodIds:shared,todayDate:today});
  for(let i=0;i<plannedRows.length;i++) for(let j=i+1;j<plannedRows.length;j++){const a=plannedRows[i],b=plannedRows[j];if(a.sleeping_allocation.tent_id===b.sleeping_allocation.tent_id&&overlapSleeping(a.sleeping_allocation,b.sleeping_allocation)) result.exact_tent_conflicts.push({tent_id:a.sleeping_allocation.tent_id,planned_period:a.sleeping_allocation,conflicting_group_id:group.id});}
  result.allowed=result.exact_tent_conflicts.length===0&&!result.neighborhood_conflicts.some(c=>c.blocked);
  return {...result,updates,intent};
}