import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// TEMPORARY incident probe. Runs the live app's direct (user-token, RLS-enforced) writes against the
// isolated B2TEST OTHER test group only. All ids are hardcoded; it can never touch a real booking.
const GROUP_ID = '6ad9e9a251bda7b343f48490';
const PROFILE_ID = '6ad9e9a21ad9ec5425e2fa9b';
const ACTIVITY_ID = '6adddea800e5d8fe514bb75e';
const ALLOCATION_ID = '6ad9e9a2905bb0ffb20bc359';

const errInfo = e => ({ ok: false, status: e?.status || e?.response?.status || null, error: e?.response?.data?.message || e?.response?.data?.detail || e?.message || String(e) });

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const db = base44.entities; // user-scoped: same permissions as the live app in the browser
    const sr = base44.asServiceRole.entities;
    const steps = {};
    const run = async (name, fn) => { try { steps[name] = { ok: true, value: await fn() }; } catch (e) { steps[name] = errInfo(e); } };

    let mealId = null;
    await run('meal_create', async () => { const m = await db.MealReservation.create({ group_id: GROUP_ID, operational_group_profile_id: PROFILE_ID, date: '2027-05-12', meal_type: 'DINNER', start_time: '19:00', end_time: '20:30', pax: 1, notes: 'RECOVERY_PROBE', source: 'manual', status: 'ACTIVE' }); mealId = m.id; return m.id; });
    if (mealId) {
      await run('meal_update', async () => (await db.MealReservation.update(mealId, { pax: 2 })).pax);
      await run('meal_cancel', async () => (await db.MealReservation.update(mealId, { status: 'CANCELLED' })).status);
    }
    await run('activity_update', async () => (await db.GroupScheduleItem.update(ACTIVITY_ID, { notes: `probe ${new Date().toISOString()}` })).notes);
    const alloc = await sr.SleepingAllocation.get(ALLOCATION_ID);
    await run('housekeeping_update', async () => (await db.SleepingAllocation.update(ALLOCATION_ID, { housekeeping_status: alloc.housekeeping_status === 'READY' ? 'PENDING' : 'READY' })).housekeeping_status);
    if (steps.housekeeping_update.ok) await sr.SleepingAllocation.update(ALLOCATION_ID, { housekeeping_status: alloc.housekeeping_status || 'PENDING' });
    const group = await sr.Group.get(GROUP_ID);
    await run('group_date_update', async () => (await db.Group.update(GROUP_ID, { departure_date: '2027-05-13' })).departure_date);
    if (steps.group_date_update.ok) await sr.Group.update(GROUP_ID, { departure_date: group.departure_date });

    const persisted = mealId ? await sr.MealReservation.get(mealId) : null;
    return Response.json({ steps, persisted_meal: persisted && { id: persisted.id, pax: persisted.pax, status: persisted.status } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}