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
// QUOTES_MANAGER can edit Group pax/dates (GroupFormModal) and remove quote talks (QuoteTalksPanel); those flows
// write pax-only syncs and status-only cancellations. Kept so the release preserves the live behavior for that role.
export const GROUP_EDIT_FOLLOWUP = [...ADMINS, 'QUOTES_MANAGER'];
const PAX_SYNC_ENTITIES = new Set(['MealReservation', 'GroupScheduleItem', 'CoffeeCornerRequest']);
const CANCEL_ENTITIES = new Set(['MealReservation', 'GroupScheduleItem']);

// Housekeeping staff may change exactly one field (housekeeping_status, valid value) and nothing else.
export function rolesFor(op, data) {
  const keys = Object.keys(data || {});
  if (op.entity === 'SleepingAllocation' && op.action === 'update' && keys.length === 1
    && keys[0] === 'housekeeping_status' && HOUSEKEEPING_STATUSES.has(data.housekeeping_status)) return MARK_TENT_READY;
  if (op.action === 'update' && keys.length === 1) {
    if (keys[0] === 'pax' && PAX_SYNC_ENTITIES.has(op.entity) && Number(data.pax) > 0) return GROUP_EDIT_FOLLOWUP;
    if (keys[0] === 'status' && data.status === 'CANCELLED' && CANCEL_ENTITIES.has(op.entity)) return GROUP_EDIT_FOLLOWUP;
  }
  return ENTITY_ROLES[op.entity] || [];
}