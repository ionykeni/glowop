import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";

// Saves the reviewed proposal through the EXISTING sleeping save paths.
// CONTINUOUS: neighborhood reservations + DRAFT rows (like manual entry), then the existing confirm.
// MULTI_PERIOD: existing logical assignments + proposal → previewMultiPeriodSleepingPlanCurrent → commit.
export async function applyContinuous({ rows, groupId, profileId, arrivalDate, departureDate, activeNhoodRes, confirm }) {
  const byHood = {};
  rows.forEach(r => (byHood[r.neighborhood_id] ||= []).push(r));
  for (const [hoodId, list] of Object.entries(byHood)) {
    if (activeNhoodRes.some(r => r.neighborhood_id === hoodId)) continue;
    const genders = new Set(list.map(r => r.gender_group));
    await opWrite.NeighborhoodReservation.create({
      group_id: groupId, operational_group_profile_id: profileId, neighborhood_id: hoodId,
      arrival_date: arrivalDate, departure_date: departureDate,
      gender_group: genders.size > 1 ? "MIXED" : [...genders][0],
      planned_tents: list.length, status: "ACTIVE", source: "allocation",
    });
  }
  await Promise.all(rows.map(r => opWrite.SleepingAllocation.create({
    group_id: groupId, operational_group_profile_id: profileId, tent_id: r.tent_id, neighborhood_id: r.neighborhood_id,
    arrival_date: arrivalDate, departure_date: departureDate, allocated_pax: r.allocated_pax,
    allocation_type: "STUDENT", gender_group: r.gender_group, status: "DRAFT", notes: "",
  })));
  return confirm();
}

export async function applyMultiPeriod({ rows, groupId, logicalAssignments }) {
  const existing = logicalAssignments.filter(a => !a.inconsistent).map(a => ({
    allocation_series_id: a.allocation_series_id, tent_id: a.tent_id, neighborhood_id: a.neighborhood_id,
    allocated_pax: a.logical_allocated_pax, allocation_type: a.allocation_type, gender_group: a.gender_group, notes: a.notes || "",
  }));
  const assignments = [...existing, ...rows.map(r => ({
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
  return true;
}