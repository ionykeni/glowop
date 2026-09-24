import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { assertSleepingAccess, sleepingWrites, readSleepingRows, sleepingToday } from '../../shared/sleepingActionCore.js';
import { loadSleepingContext } from '../../shared/actionableSleepingPlan.js';
import { planScopedAdd, planScopedNeighborhoodRelease, planScopedReAdd, planScopedRelease } from '../../shared/sleepingPeriodScope.js';
import { syncSleepingNeighborhoods } from '../../shared/sleepingNeighborhoodSync.js';
import { planScopedAutoSleeping, planContinuousAutoSleeping } from '../../shared/scopedAutoSleeping.js';
import { planReturnToPreviousSleeping } from '../../shared/returnToPreviousSleeping.js';
import { validateLinkedSeriesCompleteness } from '../../shared/logicalSleepingSeries.js';
// Scoped preview and commit revalidate global rows and the historical source on every request.

export default async function(req) {
  let writes;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await assertSleepingAccess(base44, user);
    const body = await req.json();
    if (!body.group_id) return Response.json({ success: false, error: 'חסרה קבוצה' }, { status: 400 });
    const db = base44.asServiceRole.entities;
    if (body.action === 'AUTO_CONTINUOUS') {
      const [group, profiles, rows, tents] = await Promise.all([db.Group.get(body.group_id), readSleepingRows(db.OperationalGroupProfile, { group_id: body.group_id }), readSleepingRows(db.SleepingAllocation), readSleepingRows(db.Tent)]);
      if (!group || profiles.length !== 1) throw new Error('פרטי הקבוצה אינם זמינים');
      const creates = planContinuousAutoSleeping({ group, profile: profiles[0], rows, tents, today: sleepingToday() }, body.requested);
      writes = sleepingWrites(db);
      for (const row of creates) await writes.create('SleepingAllocation', row);
      return Response.json({ success: true, action: 'AUTO_CONTINUOUS', allocated: creates.reduce((s, r) => s + r.allocated_pax, 0) });
    }
    const context = await loadSleepingContext(db, body.group_id);
    if (body.action === 'RETURN_PREVIEW' || body.action === 'RETURN_COMMIT') {
      const mine = context.rows.filter(r => r.group_id === context.group.id);
      if (!validateLinkedSeriesCompleteness(mine, context.periods, context.group.id, context.today).valid) throw new Error('השיבוץ הקיים אינו תקין; נדרשת בדיקה');
      const plan = planReturnToPreviousSleeping(context, body.selected_period_id);
      if (body.action === 'RETURN_PREVIEW') return Response.json({ success: true, read_only: true, ...plan });
      if (!Array.isArray(body.proposal_keys) || JSON.stringify(body.proposal_keys) !== JSON.stringify(plan.proposal_keys)) throw new Error('השיבוץ או הזמינות השתנו; יש להציג תצוגה מקדימה חדשה');
      if (plan.blocked.length) throw new Error(`אין אפשרות להחזיר את הקבוצה לכל השיבוץ הקודם: ${plan.blocked.join(', ')}`);
      writes = sleepingWrites(db);
      for (const row of plan.creates) {
        const { tent_code, ...saved } = row;
        await writes.create('SleepingAllocation', saved);
      }
      await syncSleepingNeighborhoods(db, writes, context.group.id, plan.creates, context.today);
      return Response.json({ success: true, action: 'RETURN_COMMIT', created: plan.creates.length, historical_rows_unchanged: true });
    }
    if (body.action === 'AUTO_PREVIEW' || body.action === 'AUTO_COMMIT') {
      const plan = planScopedAutoSleeping(context, body.edit_scope);
      if (body.action === 'AUTO_PREVIEW') return Response.json({ success: true, read_only: true, results: plan.results, warnings: plan.warnings, allocated: plan.allocated, remaining: plan.remaining, proposal_keys: plan.proposal_keys });
      if (!Array.isArray(body.proposal_keys) || JSON.stringify(body.proposal_keys) !== JSON.stringify(plan.proposal_keys)) throw new Error('הזמינות או השיבוץ השתנו; יש להציג הצעה מעודכנת');
      if (!plan.allocated) throw new Error('אין מקומות פנויים לשיבוץ');
      writes = sleepingWrites(db);
      for (const row of plan.creates) await writes.create('SleepingAllocation', row);
      const active = plan.creates.filter(row => row.status === 'DRAFT');
      const future = active.filter(row => context.periods.find(p => p.id === row.stay_period_id)?.start_date >= context.today);
      await syncSleepingNeighborhoods(db, writes, context.group.id, future, context.today);
      const current = active.filter(row => context.periods.find(p => p.id === row.stay_period_id)?.start_date < context.today);
      for (const neighborhoodId of new Set(current.map(row => row.neighborhood_id))) {
        const sample = current.find(row => row.neighborhood_id === neighborhoodId);
        const alreadyReserved = context.reservations.some(row => row.group_id === context.group.id && row.neighborhood_id === neighborhoodId && row.arrival_date <= context.today && row.departure_date > context.today);
        if (!alreadyReserved) {
          const local = current.filter(row => row.neighborhood_id === neighborhoodId);
          await writes.create('NeighborhoodReservation', { group_id: context.group.id, operational_group_profile_id: context.profile.id, neighborhood_id: neighborhoodId, stay_period_id: sample.stay_period_id, arrival_date: context.today, departure_date: sample.departure_date, gender_group: new Set(local.map(r => r.gender_group)).size === 1 ? sample.gender_group : 'MIXED', planned_tents: local.length, status: 'ACTIVE', source: 'allocation' });
        }
      }
      return Response.json({ success: true, action: 'AUTO_COMMIT', allocated: plan.allocated, remaining: plan.remaining, warnings: plan.warnings, historical_rows_unchanged: true });
    }
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