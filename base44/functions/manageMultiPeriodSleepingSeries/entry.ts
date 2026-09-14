import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { assertSleepingAccess, sleepingWrites } from '../../shared/sleepingActionCore.js';
import { loadSleepingContext } from '../../shared/actionableSleepingPlan.js';
import { planSeriesAction, applySeriesAction } from '../../shared/multiPeriodSeriesActions.js';
import { validateLinkedSeriesCompleteness } from '../../shared/logicalSleepingSeries.js';
export default async function(req) {
  let writes;
  try {
    const base44=createClientFromRequest(req),user=await base44.auth.me();
    await assertSleepingAccess(base44,user);
    const body=await req.json();
    if(!body.group_id) return Response.json({success:false,error:'חסרה קבוצה'});
    const db=base44.asServiceRole.entities,ctx=await loadSleepingContext(db,body.group_id);
    if(body.action==='inspect') {
      const validation=validateLinkedSeriesCompleteness(ctx.rows.filter(r=>r.group_id===ctx.group.id),ctx.periods,ctx.group.id);
      return Response.json({success:true,read_only:true,validation:{valid:validation.valid,errors:validation.errors}});
    }
    const plan=planSeriesAction(ctx,body);
    if(body.preview_only===true) return Response.json({success:true,read_only:true,affected_row_ids:plan.updates.map(u=>u.row.id),rows_to_create:plan.creates,warnings:plan.warnings});
    writes=sleepingWrites(db);
    await applySeriesAction(db,writes,ctx,plan);
    return Response.json({success:true,already_applied:plan.already_applied,affected_row_ids:plan.updates.map(u=>u.row.id),rows_created:plan.creates.length,warnings:plan.warnings,historical_rows_unchanged:true});
  } catch(error) {
    const recovery=writes?await writes.rollback():null;
    return Response.json({success:false,error:recovery&&!recovery.restored?'השינוי לא הושלם ונדרשת בדיקת השיבוץ לפני ניסיון נוסף':error.message,recovery});
  }
}