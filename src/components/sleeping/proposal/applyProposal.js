import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";

// Saves the reviewed proposal through the EXISTING sleeping save paths.
// CONTINUOUS: neighborhood reservations + DRAFT rows (like manual entry), then the existing confirm.
//   Every record created by the attempt is tracked on the proposal (apply_state_json) so a retry
//   reuses it instead of duplicating, and a failed confirm rolls back only those records.
// MULTI_PERIOD: existing logical assignments + proposal → previewMultiPeriodSleepingPlanCurrent → commit.

export const parseState = (p) => {
  try { return { created_alloc_ids: [], created_nhood_ids: [], ...JSON.parse(p?.apply_state_json || "{}") }; }
  catch { return { created_alloc_ids: [], created_nhood_ids: [] }; }
};
const saveState = (id, state) => base44.entities.SleepingAllocationProposal.update(id, { apply_state_json: JSON.stringify(state) });
const overlaps = (a, from, to) => a.arrival_date < to && from < a.departure_date;

// Removes only records this proposal created that are still unconfirmed. Never touches pre-existing rows.
export async function rollbackAttempt(proposalId, state, groupId) {
  const failed = [];
  const allocs = await base44.entities.SleepingAllocation.filter({ group_id: groupId });
  const byId = Object.fromEntries(allocs.map(a => [a.id, a]));
  for (const id of state.created_alloc_ids) {
    const a = byId[id];
    if (!a || a.status === "CANCELLED") continue;
    if (a.status !== "DRAFT") { failed.push(`שיבוץ ${id} כבר אושר`); continue; }
    await opWrite.SleepingAllocation.delete(id).catch(() => failed.push(`שיבוץ ${id}`));
  }
  // Re-read what actually remains — a failed delete or a confirmed row still depends on its reservation.
  const remaining = (await base44.entities.SleepingAllocation.filter({ group_id: groupId })).filter(a => a.status !== "CANCELLED");
  const mine = new Set(state.created_alloc_ids);
  for (const id of state.created_nhood_ids) {
    const res = await base44.entities.NeighborhoodReservation.get(id).catch(() => null);
    if (!res || res.status !== "ACTIVE") continue;
    const deps = remaining.filter(a => a.neighborhood_id === res.neighborhood_id);
    if (deps.length) {
      if (deps.some(a => mine.has(a.id))) failed.push(`הזמנת שכונה ${id} נשמרה (שיבוץ תלוי עדיין קיים)`);
      continue;
    }
    await opWrite.NeighborhoodReservation.delete(id).catch(() => failed.push(`הזמנת שכונה ${id}`));
  }
  const next = failed.length
    ? { ...state, recovery_required: true, recovery_ids: failed }
    : { created_alloc_ids: [], created_nhood_ids: [] };
  await saveState(proposalId, next);
  if (failed.length) throw new Error(`הביטול לא הושלם — נדרש טיפול ידני: ${failed.join(", ")}`);
}

export async function applyContinuous({ proposal, rows, groupId, profileId, arrivalDate, departureDate, otherActiveAllocs, tentCode, confirm, shared }) {
  const state = parseState(proposal);
  // Fresh reads — never rely on possibly stale UI caches for duplicate detection.
  const [groupAllocs, activeNhoodRes] = await Promise.all([
    base44.entities.SleepingAllocation.filter({ group_id: groupId }),
    base44.entities.NeighborhoodReservation.filter({ group_id: groupId, status: "ACTIVE" }),
  ]);
  if (state.recovery_required) throw new Error(`ניסיון קודם דורש טיפול ידני: ${(state.recovery_ids || []).join(", ")}`);
  const mine = new Set(state.created_alloc_ids);

  // Hard blocker: the same physical tent on overlapping dates.
  for (const r of rows) {
    const other = otherActiveAllocs.find(a => a.group_id !== groupId && a.tent_id === r.tent_id && a.status !== "CANCELLED" && overlaps(a, arrivalDate, departureDate));
    if (other) throw new Error(`אוהל ${tentCode(r.tent_id)} תפוס ע״י קבוצה אחרת באותם תאריכים`);
    const own = groupAllocs.find(a => a.tent_id === r.tent_id && a.status !== "CANCELLED" && !mine.has(a.id) && overlaps(a, arrivalDate, departureDate));
    if (own) throw new Error(`אוהל ${tentCode(r.tent_id)} כבר משובץ לקבוצה — הסר אותו מההצעה`);
  }

  // Retry-safe: rows already drafted by an earlier attempt are reused, not recreated.
  const reused = new Set(groupAllocs.filter(a => mine.has(a.id) && a.status !== "CANCELLED").map(a => a.tent_id));
  const byHood = {};
  rows.filter(r => !reused.has(r.tent_id)).forEach(r => (byHood[r.neighborhood_id] ||= []).push(r));

  const creations = [];
  for (const [hoodId, list] of Object.entries(byHood)) {
    if (activeNhoodRes.some(r => r.neighborhood_id === hoodId)) continue;
    const genders = new Set(list.map(r => r.gender_group));
    creations.push(opWrite.NeighborhoodReservation.create({
      group_id: groupId, operational_group_profile_id: profileId, neighborhood_id: hoodId,
      arrival_date: arrivalDate, departure_date: departureDate,
      gender_group: genders.size > 1 ? "MIXED" : [...genders][0],
      planned_tents: list.length, status: "ACTIVE", source: "allocation",
    }).then(rec => state.created_nhood_ids.push(rec.id)));
  }
  for (const list of Object.values(byHood)) for (const r of list) {
    creations.push(opWrite.SleepingAllocation.create({
      group_id: groupId, operational_group_profile_id: profileId, tent_id: r.tent_id, neighborhood_id: r.neighborhood_id,
      arrival_date: arrivalDate, departure_date: departureDate, allocated_pax: r.allocated_pax,
      allocation_type: "STUDENT", gender_group: r.gender_group, status: "DRAFT", notes: "",
    }).then(rec => state.created_alloc_ids.push(rec.id)));
  }
  const settled = await Promise.allSettled(creations);
  await saveState(proposal.id, state);
  if (settled.some(s => s.status === "rejected")) {
    await rollbackAttempt(proposal.id, state, groupId);
    throw new Error("יצירת הטיוטות נכשלה — מה שנוצר בניסיון זה בוטל. לא נשמר שיבוץ.");
  }

  let result;
  try { result = await confirm(shared); }
  catch (err) {
    // Confirmation may have partially succeeded server-side — reconcile real states first.
    const now = await base44.entities.SleepingAllocation.filter({ group_id: groupId });
    const created = now.filter(a => state.created_alloc_ids.includes(a.id) && a.status !== "CANCELLED");
    if (created.length && created.every(a => a.status === "CONFIRMED")) return "APPLIED";
    await rollbackAttempt(proposal.id, state, groupId); // deletes only unconfirmed drafts; confirmed ones → recovery_required
    throw new Error(`האישור נכשל (${err?.message || "שגיאה"}) — הטיוטות שנוצרו מההצעה בוטלו. ניתן לנסות שוב.`);
  }
  if (result === true) return "APPLIED";
  if (result === "NEEDS_SHARED") return "NEEDS_SHARED"; // drafts kept; retry with a reason reuses them
  await rollbackAttempt(proposal.id, state, groupId);
  throw new Error("האישור נכשל — הטיוטות שנוצרו מההצעה בוטלו. ניתן לתקן ולנסות שוב.");
}

export async function applyMultiPeriod({ rows, groupId, logicalAssignments }) {
  const existing = logicalAssignments.filter(a => !a.inconsistent).map(a => ({
    allocation_series_id: a.allocation_series_id, tent_id: a.tent_id, neighborhood_id: a.neighborhood_id,
    allocated_pax: a.logical_allocated_pax, allocation_type: a.allocation_type, gender_group: a.gender_group, notes: a.notes || "",
  }));
  // Retry-safe: tents already in the group's plan (e.g. an earlier successful commit) are not added twice.
  const existingTents = new Set(existing.map(a => a.tent_id));
  const fresh = rows.filter(r => !existingTents.has(r.tent_id));
  if (!fresh.length) return "APPLIED";
  const assignments = [...existing, ...fresh.map(r => ({
    tent_id: r.tent_id, neighborhood_id: r.neighborhood_id, allocated_pax: r.allocated_pax,
    allocation_type: "STUDENT", gender_group: r.gender_group, notes: "",
  }))];
  const preview = (await base44.functions.invoke("previewMultiPeriodSleepingPlanCurrent", { group_id: groupId, assignments, shared_neighborhoods: [] })).data;
  if (!preview?.success || !preview.allowed || preview.legacy_envelope_requires_conversion) {
    const conflicts = (preview?.exact_tent_conflicts || []).length ? "אוהל תפוס באותם תאריכים" : null;
    throw new Error(preview?.error || conflicts || (preview?.neighborhood_conflicts?.length ? "שכונה משותפת עם קבוצה אחרת — יש לאשר דרך מסך השכונה" : "הבדיקה נכשלה"));
  }
  const commit = (await base44.functions.invoke("commitMultiPeriodSleepingPlanCurrent", { group_id: groupId, assignments, shared_neighborhoods: [] })).data;
  if (!commit?.success) throw new Error(commit?.error || "שמירת התכנית נכשלה");
  return "APPLIED";
}