import { groupLogicalSleepingAssignments } from '@/components/sleeping/logicalSleepingView';

export function getVipRequirementIndex(notes = "") {
  const match = notes.match(/__vip_req_(\d+)__/);
  return match ? Number(match[1]) : null;
}

const intervalStart = row => row.segment_start_date || row.arrival_date;
const intervalEnd = row => row.segment_end_date || row.departure_date;
const overlaps = (left, right) => intervalStart(left) < intervalEnd(right) && intervalStart(right) < intervalEnd(left);

export function getVipRequirementReadModel(rows = []) {
  const byRequirement = new Map();
  rows
    .filter(row => row.status !== "CANCELLED" && row.allocation_type === "STAFF")
    .forEach(row => {
      const requirementIndex = getVipRequirementIndex(row.notes || "");
      if (requirementIndex === null) return;
      if (!byRequirement.has(requirementIndex)) byRequirement.set(requirementIndex, []);
      byRequirement.get(requirementIndex).push(row);
    });

  const requirements = [...byRequirement.entries()].map(([requirement_index, period_rows]) => {
    const paxValues = [...new Set(period_rows.map(row => Number(row.allocated_pax) || 0))];
    const overlappingRows = period_rows.some((row, index) =>
      period_rows.slice(index + 1).some(other => overlaps(row, other))
    );
    return {
      requirement_index,
      period_rows,
      allocated_pax: paxValues.length === 1 ? paxValues[0] : null,
      representative_pax: Math.max(...paxValues, 0),
      pax_varies_by_period: paxValues.length > 1,
      has_overlapping_allocations: overlappingRows,
    };
  });

  return {
    requirements,
    total_allocated_pax: requirements.reduce((sum, item) => sum + item.representative_pax, 0),
    pax_varies_by_period: requirements.some(item => item.pax_varies_by_period),
    duplicate_requirement_indexes: requirements
      .filter(item => item.has_overlapping_allocations)
      .map(item => item.requirement_index),
  };
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