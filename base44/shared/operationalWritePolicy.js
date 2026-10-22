// Role policy for writeOperationalRecord. Mirrors src/lib/roles.js (MANAGE_MEALS / MANAGE_ACTIVITIES = admins,
// MANAGE_ALLOCATION = admins + housekeeping manager, MARK_TENT_READY adds housekeeping staff).
export const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
export const ALLOCATION = [...ADMINS, 'HOUSEKEEPING_MANAGER'];
export const MARK_TENT_READY = [...ALLOCATION, 'HOUSEKEEPING_STAFF'];
// Roles that may acknowledge KITCHEN-module alerts in the UI (ReviewAlertCard) and apply the alert's pax.
export const KITCHEN_PAX_ALERT = [...ADMINS, 'OPERATIONS', 'KITCHEN'];

export const ENTITY_ROLES = {
  MealReservation: ADMINS, GroupScheduleItem: ADMINS, CoffeeCornerRequest: ADMINS, PrisaRequest: ADMINS,
  SleepingAllocation: ALLOCATION, NeighborhoodReservation: ALLOCATION,
};
export const ACTIONS = new Set(['create', 'update', 'delete']);
const HOUSEKEEPING_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'READY', 'ISSUE']);

// Housekeeping staff may change exactly one field (housekeeping_status, valid value) and nothing else.
export function rolesFor(op, data) {
  const keys = Object.keys(data || {});
  if (op.entity === 'SleepingAllocation' && op.action === 'update' && keys.length === 1
    && keys[0] === 'housekeeping_status' && HOUSEKEEPING_STATUSES.has(data.housekeeping_status)) return MARK_TENT_READY;
  return ENTITY_ROLES[op.entity] || [];
}