import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { todayIL } from '../../shared/stayReconciliationCore.js';
import { RELEASE_SPEC, findLiveCommitments, releaseRow } from '../../shared/quoteCancellationRelease.js';
import { readAll } from '../../shared/groupWriteGuard.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const { group_id, action, reason } = await req.json();

  if (!group_id || !action) {
    return Response.json({ error: 'group_id and action are required' }, { status: 400 });
  }
  if (!['complete', 'freeze', 'cancel', 'reactivate'].includes(action)) {
    return Response.json({ error: 'Invalid action. Use: complete | freeze | cancel | reactivate' }, { status: 400 });
  }

  // Fetch the group
  let group;
  try {
    const groups = await base44.asServiceRole.entities.Group.filter({ id: group_id });
    group = groups[0];
  } catch (_) {
    // filter may throw on invalid id
  }
  if (!group) {
    return Response.json({ error: 'Group not found' }, { status: 404 });
  }
  // A Quote cancellation owns this Group (atomic lock); lifecycle changes must not race it.
  if (group.cancellation_operation_id) {
    return Response.json({ error: 'GROUP_CANCELLATION_IN_PROGRESS' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const summary = { sleepingAllocations: 0, mealReservations: 0, scheduleItems: 0, neighborhoodReservations: 0, operationalHolds: 0 };

  if (action === 'complete' || action === 'freeze' || action === 'cancel') {
    // Cancel SleepingAllocations
    const allocations = await base44.asServiceRole.entities.SleepingAllocation.filter({ group_id });
    const activeAllocs = allocations.filter(a => a.status !== 'CANCELLED');
    for (const a of activeAllocs) {
      await base44.asServiceRole.entities.SleepingAllocation.update(a.id, { status: 'CANCELLED' });
      summary.sleepingAllocations++;
    }

    // Cancel MealReservations
    const meals = await base44.asServiceRole.entities.MealReservation.filter({ group_id });
    const activeMeals = meals.filter(m => m.status === 'ACTIVE');
    for (const m of activeMeals) {
      await base44.asServiceRole.entities.MealReservation.update(m.id, { status: 'CANCELLED' });
      summary.mealReservations++;
    }

    // Cancel GroupScheduleItems
    const scheduleItems = await base44.asServiceRole.entities.GroupScheduleItem.filter({ group_id });
    const activeItems = scheduleItems.filter(i => i.status === 'ACTIVE');
    for (const i of activeItems) {
      await base44.asServiceRole.entities.GroupScheduleItem.update(i.id, { status: 'CANCELLED' });
      summary.scheduleItems++;
    }

    // Cancel NeighborhoodReservations
    const nrList = await base44.asServiceRole.entities.NeighborhoodReservation.filter({ group_id });
    const activeNR = nrList.filter(r => r.status === 'ACTIVE');
    for (const r of activeNR) {
      await base44.asServiceRole.entities.NeighborhoodReservation.update(r.id, { status: 'CANCELLED' });
      summary.neighborhoodReservations++;
    }

    // Cancel CoffeeCornerRequests
    const coffeeList = await base44.asServiceRole.entities.CoffeeCornerRequest.filter({ group_id });
    const activeCoffee = coffeeList.filter(c => c.status === 'ACTIVE');
    for (const c of activeCoffee) {
      await base44.asServiceRole.entities.CoffeeCornerRequest.update(c.id, { status: 'CANCELLED' });
      summary.coffeeRequests = (summary.coffeeRequests || 0) + 1;
    }

    // Cancel PrisaRequests
    const prisaList = await base44.asServiceRole.entities.PrisaRequest.filter({ group_id });
    const activePrisa = prisaList.filter(p => p.status === 'ACTIVE');
    for (const p of activePrisa) {
      await base44.asServiceRole.entities.PrisaRequest.update(p.id, { status: 'CANCELLED', cancelled_date: now });
      summary.prisaRequests = (summary.prisaRequests || 0) + 1;
    }

    // Release OperationalHolds
    const holds = await base44.asServiceRole.entities.OperationalHold.filter({ group_id });
    const activeHolds = holds.filter(h => h.status === 'ACTIVE');
    for (const h of activeHolds) {
      await base44.asServiceRole.entities.OperationalHold.update(h.id, { status: 'RELEASED' });
      summary.operationalHolds++;
    }

    // Update group status
    if (action === 'complete') {
      await base44.asServiceRole.entities.Group.update(group_id, {
        status: 'COMPLETED',
        completed_at: now,
      });
    } else if (action === 'cancel') {
      await base44.asServiceRole.entities.Group.update(group_id, {
        status: 'CANCELLED',
      });
      // Final sweep after the status is visible: catches guarded writes that passed their re-check before
      // CANCELLED was stored. Later writers see CANCELLED and release themselves (groupWriteGuard).
      const db = base44.asServiceRole.entities;
      const live = await findLiveCommitments(db, group_id, todayIL(), readAll);
      for (const spec of RELEASE_SPEC) for (const row of live[spec.key]) await releaseRow(db, spec, row);
    } else {
      await base44.asServiceRole.entities.Group.update(group_id, {
        status: 'ARCHIVED',
        archived_at: now,
        archived_reason: reason || '',
      });
    }
  }

  if (action === 'reactivate') {
    if (group.status !== 'ARCHIVED' && group.status !== 'COMPLETED') {
      return Response.json({ error: 'Group is not archived or completed' }, { status: 400 });
    }
    await base44.asServiceRole.entities.Group.update(group_id, {
      status: 'DRAFT',
      archived_at: null,
      archived_reason: null,
      completed_at: null,
    });
  }

  return Response.json({
    success: true,
    action,
    group_id,
    summary,
  });
});