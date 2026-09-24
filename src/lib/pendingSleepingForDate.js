// Read-only Dashboard badge. Presence is decided by stay periods elsewhere, never here.
// True only when a sleeping group has ZERO valid CONFIRMED allocations covering the given night.
// Partial allocation is an Allocation concern and never triggers this.
export function hasNoSleepingTonight(group, profile, allocations, date) {
  if (group.group_type !== 'LODGING' || !profile?.is_sleeping_group) return false;
  return !allocations.some(r => r.group_id === group.id && r.status === 'CONFIRMED' && r.tent_id && Number(r.allocated_pax) > 0
    && r.arrival_date <= date && date < r.departure_date);
}
// Compatibility alias for any remaining caller; same zero-coverage rule.
export const pendingSleepingForDate = (group, profile, periods, allocations, date) => hasNoSleepingTonight(group, profile, allocations, date);