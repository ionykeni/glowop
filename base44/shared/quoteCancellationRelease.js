import { isValidDateString } from './groupStayPeriods.js';

// Shared by previewQuoteBookingCancellation and commitQuoteCancellation: one release mechanism for both
// reasons. All dates are Asia/Jerusalem YYYY-MM-DD strings.
export const single = date => today => !isValidDateString(date) ? 'INVALID_DATES' : date < today ? 'PAST' : date > today ? 'FUTURE' : 'TODAY';
export const exclusive = (start, endEx) => today => {
  if (!isValidDateString(start) || !isValidDateString(endEx) || start >= endEx) return 'INVALID_DATES';
  if (endEx <= today) return 'PAST'; if (start > today) return 'FUTURE'; return start === today ? 'TODAY' : 'IN_PROGRESS';
};
export const inclusive = (start, end) => today => {
  if (!isValidDateString(start) || !isValidDateString(end) || end < start) return 'INVALID_DATES';
  if (end < today) return 'PAST'; if (start > today) return 'FUTURE'; return start === today ? 'TODAY' : 'IN_PROGRESS';
};

// Released = active rows classified FUTURE / TODAY / IN_PROGRESS (unused planned commitments; the caller has
// already required the no-arrival declaration when arrival <= today). PAST rows are never modified.
export const RELEASABLE = new Set(['FUTURE', 'TODAY', 'IN_PROGRESS']);
export const RELEASE_SPEC = [
  { key: 'stay_periods', entity: 'GroupStayPeriod', field: 'group_id', active: ['ACTIVE'], to: { status: 'CANCELLED' }, cls: r => inclusive(r.start_date, r.end_date) },
  { key: 'sleeping_allocations', entity: 'SleepingAllocation', field: 'group_id', active: ['DRAFT', 'CONFIRMED'], to: { status: 'CANCELLED' }, cls: r => exclusive(r.arrival_date, r.departure_date) },
  { key: 'neighborhood_reservations', entity: 'NeighborhoodReservation', field: 'group_id', active: ['ACTIVE'], to: { status: 'CANCELLED' }, cls: r => exclusive(r.arrival_date, r.departure_date) },
  { key: 'meal_reservations', entity: 'MealReservation', field: 'group_id', active: ['ACTIVE'], to: { status: 'CANCELLED' }, cls: r => single(r.date) },
  { key: 'schedule_items', entity: 'GroupScheduleItem', field: 'group_id', active: ['ACTIVE'], to: { status: 'CANCELLED' }, cls: r => single(r.date) },
  { key: 'coffee_requests', entity: 'CoffeeCornerRequest', field: 'group_id', active: ['ACTIVE'], to: { status: 'CANCELLED' }, cls: r => single(r.date) },
  { key: 'prisa_requests', entity: 'PrisaRequest', field: 'group_id', active: ['ACTIVE'], to: { status: 'CANCELLED' }, stamp: 'cancelled_date', cls: r => single(r.date) },
  { key: 'operational_holds', entity: 'OperationalHold', field: 'group_id', active: ['ACTIVE'], to: { status: 'RELEASED' }, cls: r => inclusive(r.arrival_date, r.departure_date) },
  { key: 'mechina_space_requests', entity: 'CommonSpaceBookingRequest', field: 'mechina_group_id', active: ['PENDING', 'APPROVED', 'CHANGE_REQUESTED', 'CANCELLATION_REQUESTED'], to: { status: 'CANCELLED' }, cls: r => single(r.date) },
];

// Full read (no partial lists) of every still-active releasable row of the Group.
export async function findLiveCommitments(db, groupId, today, readAll) {
  const out = {};
  await Promise.all(RELEASE_SPEC.map(async spec => {
    const rows = await readAll(db[spec.entity], { [spec.field]: groupId });
    out[spec.key] = rows.filter(r => spec.active.includes(r.status) && RELEASABLE.has(spec.cls(r)(today)));
  }));
  return out;
}

// Idempotent conditional release: only changes the row if it is still in the status we read.
export async function releaseRow(db, spec, row) {
  const set = { ...spec.to, ...(spec.stamp ? { [spec.stamp]: new Date().toISOString() } : {}) };
  const res = await db[spec.entity].updateMany({ id: row.id, status: row.status }, { $set: set });
  return res?.updated === 1;
}