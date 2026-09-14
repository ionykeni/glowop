import { groupLogicalSleepingAssignments } from '@/components/sleeping/logicalSleepingView';

export function getVipRequirementIndex(notes = "") {
  const match = notes.match(/__vip_req_(\d+)__/);
  return match ? Number(match[1]) : null;
}

export function getLogicalVipAllocations(rows = []) {
  return groupLogicalSleepingAssignments(rows)
    .logical_assignments
    .filter(item => item.allocation_type === "STAFF" && getVipRequirementIndex(item.notes) !== null)
    .map(item => ({
      ...item,
      id: item.period_rows[0]?.id,
      status: item.all_confirmed ? "CONFIRMED" : "DRAFT",
      allocated_pax: item.logical_allocated_pax,
      requirement_index: getVipRequirementIndex(item.notes),
    }));
}

export function toSleepingAssignmentPrototype(item) {
  return {
    allocation_series_id: item.allocation_series_id,
    tent_id: item.tent_id,
    neighborhood_id: item.neighborhood_id,
    allocated_pax: item.logical_allocated_pax,
    allocation_type: item.allocation_type,
    gender_group: item.gender_group,
    notes: item.notes || "",
  };
}