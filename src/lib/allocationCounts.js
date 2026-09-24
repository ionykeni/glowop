/**
 * Unified allocation counting utility.
 *
 * Counts ALL active SleepingAllocation records for a group regardless of
 * allocation_type (STUDENT, STAFF) or internal markers (__alt_tent__, __vip_req_N__).
 *
 * Uses allocated_pax from actual SleepingAllocation records — never from
 * tent capacity, distribution JSON plans, or UI card display.
 */

import { groupLogicalSleepingAssignments } from "@/components/sleeping/logicalSleepingView";
import { getVipRequirementReadModel } from "@/lib/vipLogicalAllocations";

const ALT_TENT_MARKER = "__alt_tent__";
const VIP_REQ_MARKER  = /__vip_req_\d+__/;

/**
 * @param {Array}  allocations - all SleepingAllocation records for the group
 * @param {Object} profile     - OperationalGroupProfile record
 * @returns {Object}
 */
export function computeAllocationCounts(allocations = [], profile = null) {
  const active = allocations.filter(a => a.status !== "CANCELLED");
  const seriesData = groupLogicalSleepingAssignments(active);
  const logical = seriesData.logical_assignments;
  const validLogical = logical.filter(a => !a.inconsistent);

  const studentAllocs = validLogical.filter(a => a.allocation_type === "STUDENT");
  const staffAllocs   = validLogical.filter(a => a.allocation_type === "STAFF");
  const vipAllocs = staffAllocs.filter(a => VIP_REQ_MARKER.test(a.notes || ""));
  const altTentAllocs = staffAllocs.filter(a => (a.notes || "").includes(ALT_TENT_MARKER));
  const otherStaffAllocs = staffAllocs.filter(
    a => !VIP_REQ_MARKER.test(a.notes || "") && !(a.notes || "").includes(ALT_TENT_MARKER)
  );

  const studentAllocated   = studentAllocs.reduce((s, a) => s + a.logical_allocated_pax, 0);
  const vipReadModel       = getVipRequirementReadModel(vipAllocs.flatMap(item => item.period_rows || [item]));
  const vipAllocated       = vipReadModel.total_allocated_pax;
  const altTentAllocated   = altTentAllocs.reduce((s, a) => s + a.logical_allocated_pax, 0);
  const otherStaffAllocated = otherStaffAllocs.reduce((s, a) => s + a.logical_allocated_pax, 0);
  const staffAllocated     = vipAllocated + altTentAllocated + otherStaffAllocated;
  const totalAllocated     = studentAllocated + staffAllocated;

  const studentTentCount   = new Set(studentAllocs.map(a => a.tent_id)).size;
  const vipTentCount       = new Set(vipAllocs.map(a => a.tent_id)).size;
  const altTentCount       = new Set(altTentAllocs.map(a => a.tent_id)).size;
  const hasInvalidSeries = seriesData.inconsistent_series.length > 0;
  const countMetadata = {
    activeCount: logical.length,
    physicalActiveCount: active.length,
    logicalAssignmentCount: logical.length,
    confirmedCount: logical.filter(a => a.all_confirmed).length,
    draftCount: logical.filter(a => a.has_draft).length,
    hasInvalidSeries,
    vipPaxVariesByPeriod: vipReadModel.pax_varies_by_period,
    duplicateVipRequirementIndexes: vipReadModel.duplicate_requirement_indexes,
    invalidSeries: seriesData.inconsistent_series.map(a => ({ allocation_series_id: a.allocation_series_id, errors: a.consistency_errors })),
  };

  // ── Required counts (from profile) ────────────────────────────────────
  if (!profile) {
    return {
      studentAllocated, vipAllocated, altTentAllocated, otherStaffAllocated,
      staffAllocated, totalAllocated,
      studentTentCount, vipTentCount, altTentCount,
      studentRequired: 0, staffRequired: 0, totalRequired: 0,
      studentRemaining: 0, staffRemaining: 0, totalRemaining: 0,
      isComplete: !hasInvalidSeries,
      ...countMetadata,
    };
  }

  // ── Student required ─────────────────────────────────────────────────
  // Only use explicit bed counts from דרישות לינה.
  // Never fall back to participant_count — that would double-count staff-only groups.
  const boysRequired  = Number(profile.boys_beds_needed  ?? profile.boys_count  ?? 0) || 0;
  const girlsRequired = Number(profile.girls_beds_needed ?? profile.girls_count ?? 0) || 0;
  const studentRequired = boysRequired + girlsRequired;

  // ── Staff required ────────────────────────────────────────────────────
  // staff_count is the total number of staff/VIP/adults who need beds.
  // VIP tents and אוהל חילופי are WHERE they sleep — not extra people.
  // staff_alt_tent_pax is the count of staff sleeping in alt tents (subset of staff_count).
  // Do NOT add staff_alt_tent_pax on top of staff_count.
  const staffRequired = Number(profile.staff_count ?? 0) || 0;

  const totalRequired = studentRequired + staffRequired;

  // Remaining
  const studentRemaining = Math.max(0, studentRequired - studentAllocated);
  const staffRemaining   = Math.max(0, staffRequired - staffAllocated);
  const totalRemaining   = Math.max(0, totalRequired - totalAllocated);

  const isComplete = !hasInvalidSeries && totalRequired > 0 && totalRemaining === 0;

  return {
    studentAllocated, vipAllocated, altTentAllocated, otherStaffAllocated,
    staffAllocated, totalAllocated,
    studentTentCount, vipTentCount, altTentCount,
    studentRequired, staffRequired, totalRequired,
    studentRemaining, staffRemaining, totalRemaining,
    isComplete,
    ...countMetadata,
  };
}