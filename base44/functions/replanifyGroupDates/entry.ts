import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Re-plans a group's dates and cascades the change to all dependent operational
 * records, so shortening/lengthening a group's stay never leaves "ghost" data.
 *
 * Payload:
 *   group_id            string (required)
 *   new_arrival_date    string YYYY-MM-DD (required)
 *   new_departure_date  string YYYY-MM-DD (required — for DAY_USE pass same as arrival)
 *   dry_run             boolean (default true) — when true, only returns an impact summary, no writes
 */
Deno.serve(async (req) => {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { group_id, new_arrival_date, new_departure_date, dry_run = true } = body;

    if (!group_id || !new_arrival_date) {
      return Response.json({ success: false, error: 'group_id and new_arrival_date are required' }, { status: 400 });
    }

    const groups = await base44.asServiceRole.entities.Group.filter({ id: group_id });
    const group = groups[0];
    if (!group) return Response.json({ success: false, error: 'Group not found' }, { status: 404 });

    const newArrival   = new_arrival_date;
    const newDeparture = group.group_type === 'DAY_USE' ? new_arrival_date : (new_departure_date || new_arrival_date);
    const oldArrival    = group.arrival_date;
    const oldDeparture  = group.departure_date || group.arrival_date;

    if (newArrival === oldArrival && newDeparture === oldDeparture) {
      return Response.json({ success: true, no_change: true });
    }

    // ── Load all dependent records in parallel ──────────────────────────────
    const [allocations, scheduleItems, meals, prisaRequests, coffeeRequests] = await Promise.all([
      base44.asServiceRole.entities.SleepingAllocation.filter({ group_id, status: { $in: ['DRAFT', 'CONFIRMED'] } }),
      base44.asServiceRole.entities.GroupScheduleItem.filter({ group_id, status: 'ACTIVE' }),
      base44.asServiceRole.entities.MealReservation.filter({ group_id, status: 'ACTIVE' }),
      base44.asServiceRole.entities.PrisaRequest.filter({ group_id, status: 'ACTIVE' }),
      base44.asServiceRole.entities.CoffeeCornerRequest.filter({ group_id, status: 'ACTIVE' }),
    ]);

    const isOutOfRange = (date) => !date || date < newArrival || date > newDeparture;

    // Allocations: clip to the new range; cancel if clipping makes them invalid
    const allocationPlans = allocations.map((a) => {
      const clippedArrival   = a.arrival_date < newArrival ? newArrival : a.arrival_date;
      const clippedDeparture = a.departure_date > newDeparture ? newDeparture : a.departure_date;
      const invalid = clippedArrival >= clippedDeparture;
      const changed = clippedArrival !== a.arrival_date || clippedDeparture !== a.departure_date;
      return { record: a, invalid, changed, clippedArrival, clippedDeparture };
    });
    const allocationsToCancel = allocationPlans.filter(p => p.invalid);
    const allocationsToTrim   = allocationPlans.filter(p => !p.invalid && p.changed);

    const scheduleItemsOut = scheduleItems.filter(i => isOutOfRange(i.date));
    const mealsOut         = meals.filter(m => isOutOfRange(m.date));
    const prisaOut         = prisaRequests.filter(p => isOutOfRange(p.date));
    const coffeeOut        = coffeeRequests.filter(c => isOutOfRange(c.date));

    const summary = {
      allocations_trimmed: allocationsToTrim.length,
      allocations_cancelled: allocationsToCancel.length,
      schedule_items_cancelled: scheduleItemsOut.length,
      meals_cancelled: mealsOut.length,
      prisa_cancelled: prisaOut.length,
      coffee_cancelled: coffeeOut.length,
    };
    summary.has_impact = Object.values(summary).some(v => v > 0);

    if (dry_run) {
      return Response.json({ success: true, dry_run: true, summary });
    }

    // ── Apply changes ─────────────────────────────────────────────────────
    if (allocationsToCancel.length > 0) {
      await base44.asServiceRole.entities.SleepingAllocation.bulkUpdate(
        allocationsToCancel.map(p => ({ id: p.record.id, status: 'CANCELLED' }))
      );
    }
    if (allocationsToTrim.length > 0) {
      await base44.asServiceRole.entities.SleepingAllocation.bulkUpdate(
        allocationsToTrim.map(p => ({ id: p.record.id, arrival_date: p.clippedArrival, departure_date: p.clippedDeparture }))
      );
    }

    // Schedule items updated one-by-one so the Google Calendar sync automation fires per item
    for (const item of scheduleItemsOut) {
      await base44.asServiceRole.entities.GroupScheduleItem.update(item.id, { status: 'CANCELLED' });
    }

    if (mealsOut.length > 0) {
      await base44.asServiceRole.entities.MealReservation.bulkUpdate(
        mealsOut.map(m => ({ id: m.id, status: 'CANCELLED' }))
      );
    }
    if (prisaOut.length > 0) {
      await base44.asServiceRole.entities.PrisaRequest.bulkUpdate(
        prisaOut.map(p => ({ id: p.id, status: 'CANCELLED', cancelled_date: new Date().toISOString() }))
      );
    }
    if (coffeeOut.length > 0) {
      await base44.asServiceRole.entities.CoffeeCornerRequest.bulkUpdate(
        coffeeOut.map(c => ({ id: c.id, status: 'CANCELLED' }))
      );
    }

    await base44.asServiceRole.entities.Group.update(group_id, {
      arrival_date: newArrival,
      departure_date: newDeparture,
    });

    return Response.json({ success: true, applied: true, summary });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});