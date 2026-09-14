import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { assertSleepingAccess, sleepingWrites } from '../../shared/sleepingActionCore.js';
import { loadSleepingContext, prepareActionableSleepingPlan } from '../../shared/actionableSleepingPlan.js';
import { syncSleepingNeighborhoods } from '../../shared/sleepingNeighborhoodSync.js';

export default async function(req) {
  const runtimeBuild = 'MP_COMMIT_CURRENT_2026_09_14';
  let writes;
  try {
    const base44=createClientFromRequest(req),user=await base44.auth.me();
    await assertSleepingAccess(base44,user);
    const body=await req.json();
    if(!body.group_id) return Response.json({success:false,error:'חסרה קבוצה',runtime_build:runtimeBuild});
    const db=base44.asServiceRole.entities,ctx=await loadSleepingContext(db,body.group_id);
    const plan=prepareActionableSleepingPlan(ctx,body.assignments,body.shared_neighborhoods);
    if(!plan.allowed) return Response.json({success:false,error:'לא ניתן לשמור: קיימת התנגשות בתכנית הלינה',exact_tent_conflicts:plan.exact_tent_conflicts,neighborhood_conflicts:plan.neighborhood_conflicts,runtime_build:runtimeBuild});
    writes=sleepingWrites(db);
    const fresh=plan.planned_rows.filter(r=>!r.existing_id),created=[];
    for(const row of fresh) created.push(await writes.create('SleepingAllocation',row.sleeping_allocation));
    for(const update of plan.updates) { if(update.row.departure_date<=ctx.today) throw new Error('אין לשנות שיבוץ היסטורי'); await writes.update('SleepingAllocation',update.row,update.data); }
    await syncSleepingNeighborhoods(db,writes,ctx.group.id,plan.planned_rows.map(r=>r.sleeping_allocation),ctx.today);
    for(const intent of Object.values(plan.intent.byNeighborhoodId)) {
      const reservations=await db.NeighborhoodReservation.filter({group_id:ctx.group.id,neighborhood_id:intent.neighborhood_id,status:'ACTIVE'});
      for(const row of reservations.filter(r=>r.departure_date>ctx.today)) if(!row.shared_neighborhood_allowed) await writes.update('NeighborhoodReservation',row,{shared_neighborhood_allowed:true,shared_neighborhood_reason:intent.reason,shared_neighborhood_approved_by:user.email,shared_neighborhood_approved_at:new Date().toISOString()});
    }
    return Response.json({success:true,already_committed:!fresh.length&&!plan.updates.length,pax_edit:plan.updates.length>0,sleeping_rows_created:created.length,sleeping_rows_updated:plan.updates.length,sleeping_allocation_ids:created.map(r=>r.id),historical_rows_unchanged:true,runtime_build:runtimeBuild});
  } catch(error) {
    const recovery=writes?await writes.rollback():null;
    return Response.json({success:false,error:recovery&&!recovery.restored?'השמירה לא הושלמה ונדרשת בדיקת השיבוץ לפני ניסיון נוסף':error.message,recovery,runtime_build:runtimeBuild});
  }
}