import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { assertSleepingAccess, sleepingWrites } from '../../shared/sleepingActionCore.js';
import { loadSleepingContext } from '../../shared/actionableSleepingPlan.js';
import { planScopedAdd, planScopedNeighborhoodRelease, planScopedReAdd, planScopedRelease } from '../../shared/sleepingPeriodScope.js';
import { syncSleepingNeighborhoods } from '../../shared/sleepingNeighborhoodSync.js';
// Runtime bundle refreshed after released-helper metadata schema deployment.

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
    if (body.action === 'DISMISS_RELEASED_HELPER') {
      const row = context.rows.find(item => item.id === body.allocation_id && item.group_id === context.group.id);
      if (!row || row.series_action !== 'RELEASE') throw new Error('השיבוץ ששוחרר לא נמצא');
      writes = sleepingWrites(db);
      const updated = await writes.update('SleepingAllocation', row, {
        released_helper_dismissed: true,
        released_helper_dismissed_at: new Date().toISOString(),
        released_helper_dismissed_by: user.email,
      });
      if (updated?.released_helper_dismissed !== true) throw new Error('סימון ההסרה לא נשמר; יש לנסות שוב');
      return Response.json({ success: true, action: body.action, allocation_id: row.id, released_helper_dismissed: true, historical_row_deleted: false, occupancy_fields_changed: false });
    }
    const plan = body.action === 'ADD' ? planScopedAdd(context, body)
      : body.action === 'READD' ? planScopedReAdd(context, body)
      : body.action === 'RELEASE_NEIGHBORHOOD' ? planScopedNeighborhoodRelease(context, body)
      : planScopedRelease(context, body);
    writes = sleepingWrites(db);
    for (const row of plan.creates) await writes.create('SleepingAllocation', row);
    for (const item of plan.updates) await writes.update('SleepingAllocation', item.row, item.data);
    await syncSleepingNeighborhoods(db, writes, context.group.id, [...plan.updates.map(item => item.row), ...plan.creates], context.today);
    return Response.json({ success: true, action: body.action === 'RELEASE_NEIGHBORHOOD' ? body.action : ['ADD', 'READD'].includes(body.action) ? body.action : 'RELEASE', affected_period_count: plan.affectedPeriods.length, affected_row_count: plan.affectedRowCount ?? plan.updates.length, warnings: plan.warnings, historical_rows_unchanged: true });
  } catch (error) {
    const recovery = writes ? await writes.rollback() : null;
    return Response.json({ success: false, error: recovery && !recovery.restored ? 'הפעולה לא הושלמה ונדרשת בדיקה' : error.message, recovery }, { status: 400 });
  }
}