import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { inventoryCapacity, inventoryTentCount, toInventory } from '../../shared/sleepingFeasibility.js';
import { loadSiteCapacityData, buildSiteCapacityContext, evaluateExistingNight } from '../../shared/siteNightCapacity.js';

/**
 * Read-only monthly site sleeping availability for Quote planning.
 * Shows remaining site capacity BEFORE adding any Quote. Never writes.
 * Payload: { start_date, end_date } (YYYY-MM-DD, end exclusive, max 62 nights)
 */
const num = v => Number(v) || 0;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { start_date, end_date } = await req.json();
    if (!start_date || !end_date || end_date <= start_date) return Response.json({ error: "Invalid range" }, { status: 400 });

    const data = await loadSiteCapacityData(base44.asServiceRole.entities);
    const ctx = buildSiteCapacityContext(data);
    const stdTotal = inventoryCapacity(toInventory(ctx.standardTents.map(t => num(t.capacity))));
    const vipTotal = inventoryCapacity(toInventory(ctx.vipTents.map(t => num(t.capacity))));
    const maxSleeping = num(data.settings.max_sleeping_pax);

    const days = [];
    const cur = new Date(`${start_date}T00:00:00Z`);
    const end = new Date(`${end_date}T00:00:00Z`);
    while (cur < end && days.length < 62) {
      const night = cur.toISOString().slice(0, 10);
      const ex = evaluateExistingNight(ctx, night);
      const regular = inventoryCapacity(ex.stdInv);
      const vip = inventoryCapacity(ex.vipInv);
      const peopleLeft = maxSleeping > 0 ? maxSleeping - ex.existingPeople : null;
      const ratio = stdTotal > 0 ? regular / stdTotal : 0;
      const peopleRatio = maxSleeping > 0 ? peopleLeft / maxSleeping : 1;
      const worst = Math.min(ratio, peopleRatio);
      const status = ex.existingOvercommitted || worst < 0.15 ? "RED" : worst < 0.4 ? "YELLOW" : "GREEN";
      days.push({
        night, status, regular_places: regular, vip_places: vip,
        regular_tents: inventoryTentCount(ex.stdInv), vip_tents: inventoryTentCount(ex.vipInv),
        existing_people: ex.existingPeople, people_left: peopleLeft,
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return Response.json({ days, totals: { regular: stdTotal, vip: vipTotal, max_sleeping: maxSleeping } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}