import { groupLogicalSleepingAssignments } from "@/components/sleeping/logicalSleepingView";

export const ALT_TENT_MARKER = "__alt_tent__";

export function getLogicalAltTentAllocations(rows = []) {
  return groupLogicalSleepingAssignments(rows)
    .logical_assignments
    .filter(item => item.allocation_type === "STAFF" && (item.notes || "").includes(ALT_TENT_MARKER))
    .map(item => ({
      ...item,
      id: item.period_rows[0]?.id,
      status: item.all_confirmed ? "CONFIRMED" : "DRAFT",
      allocated_pax: item.logical_allocated_pax,
    }));
}