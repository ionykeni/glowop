/**
 * syncExistingOperationalPaxForGroup
 *
 * When group total_pax changes, update pax on existing active records:
 *   - MealReservation: update pax only
 *   - GroupScheduleItem: update pax only (skip split rows — they have split_group_id)
 *   - CoffeeCornerRequest: update pax only
 *
 * Rules:
 *   - Never creates new records
 *   - Never changes date / time / type / location / notes / source
 *   - Split activity rows (split_group_id != null) are left untouched
 */

import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";

export async function syncExistingOperationalPaxForGroup(groupId, newTotalPax) {
  if (!groupId || newTotalPax == null || Number(newTotalPax) <= 0) return;
  const pax = Number(newTotalPax);

  const [meals, activities, coffeeRequests] = await Promise.all([
    base44.entities.MealReservation.filter({ group_id: groupId, status: "ACTIVE" }),
    base44.entities.GroupScheduleItem.filter({ group_id: groupId, status: "ACTIVE" }),
    base44.entities.CoffeeCornerRequest.filter({ group_id: groupId, status: "ACTIVE" }),
  ]);

  const ops = [];

  // Meals — update pax only; undefined/false lock remains backward-compatible and unlocked
  meals.forEach(m => {
    if (m.pax_sync_locked !== true && m.pax !== pax) {
      ops.push(opWrite.MealReservation.update(m.id, { pax }));
    }
  });

  // Activities — skip split rows (split_group_id is set)
  activities.forEach(a => {
    if (a.split_group_id) return; // leave split rows untouched
    if (a.pax !== pax) {
      ops.push(opWrite.GroupScheduleItem.update(a.id, { pax }));
    }
  });

  // Coffee corner requests — update pax only
  coffeeRequests.forEach(c => {
    if (c.pax !== pax) {
      ops.push(opWrite.CoffeeCornerRequest.update(c.id, { pax }));
    }
  });

  if (ops.length > 0) {
    await Promise.all(ops);
  }
}