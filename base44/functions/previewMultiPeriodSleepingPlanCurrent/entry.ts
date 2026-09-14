import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { assertSleepingAccess } from '../../shared/sleepingActionCore.js';
import { loadSleepingContext, prepareActionableSleepingPlan } from '../../shared/actionableSleepingPlan.js';

export default async function(req) {
  const runtimeBuild = 'MP_PREVIEW_CURRENT_2026_09_14';
  try {
    const base44=createClientFromRequest(req),user=await base44.auth.me();
    await assertSleepingAccess(base44,user);
    const body=await req.json();
    if(!body.group_id) return Response.json({success:false,error:'חסרה קבוצה',runtime_build:runtimeBuild});
    const ctx=await loadSleepingContext(base44.asServiceRole.entities,body.group_id);
    const plan=prepareActionableSleepingPlan(ctx,body.assignments,body.shared_neighborhoods);
    const {updates,intent,...preview}=plan;
    return Response.json({success:true,read_only:true,today_il:ctx.today,legacy_envelope_requires_conversion:false,...preview,runtime_build:runtimeBuild});
  } catch(error) { return Response.json({success:false,error:error.message,runtime_build:runtimeBuild}); }
}