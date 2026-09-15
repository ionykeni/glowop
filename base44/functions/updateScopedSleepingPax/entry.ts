import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { assertSleepingAccess, sleepingWrites } from '../../shared/sleepingActionCore.js';
import { loadSleepingContext } from '../../shared/actionableSleepingPlan.js';
import { planScopedPaxChange } from '../../shared/sleepingPeriodScope.js';

export default async function(req) {
  let writes;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await assertSleepingAccess(base44, user);
    const body = await req.json();
    if (!body.group_id) return Response.json({ success: false, error: 'חסרה קבוצה' }, { status: 400 });
    const db = base44.asServiceRole.entities;
    const context = await loadSleepingContext(db, body.group_id);
    const plan = planScopedPaxChange(context, body);
    writes = sleepingWrites(db);
    for (const row of plan.creates) await writes.create('SleepingAllocation', row);
    for (const item of plan.updates) await writes.update('SleepingAllocation', item.row, item.data);
    return Response.json({ success: true, affected_period_count: plan.affectedPeriods.length, warnings: plan.warnings, historical_rows_unchanged: true });
  } catch (error) {
    const recovery = writes ? await writes.rollback() : null;
    return Response.json({ success: false, error: recovery && !recovery.restored ? 'השינוי לא הושלם ונדרשת בדיקה' : error.message, recovery }, { status: 400 });
  }
}