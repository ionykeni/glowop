import {
  deriveStayEnvelope,
  getOperationalStayDates,
  isDateInsideStayPeriods,
  normalizeStayPeriods,
  occupiesSleepingNight,
  validateStayPeriods,
} from './groupStayPeriods.js';
import { groupLogicalSleepingAssignments, validateLinkedSeriesCompleteness } from './logicalSleepingSeries.js';
import { isGroupOperationallyEnabled } from './groupOperationalIsolation.js';
import { fingerprint, periodShape, readAll, todayIL } from './stayReconciliationCore.js';
import { planStaySleeping } from './staySleepingPlan.js';
import { serviceImpacts } from './stayServiceImpacts.js';
import { sleepingCoverage } from './staySleepingCoverage.js';

const ACTIVE_GROUP_STATUSES = new Set(['CONFIRMED', 'COMPLETED']);
const ACTIVE_ALLOCATION_STATUSES = new Set(['DRAFT', 'CONFIRMED']);

function uniq(values) { return [...new Set(values)].sort(); }
function difference(a, b) { const other = new Set(b); return a.filter(value => !other.has(value)); }
function overlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }
function nextDate(value) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
function sleepingNights(periods) {
  const nights = [];
  for (const period of periods) {
    for (let date = period.start_date; date < period.end_date;) {
      nights.push(date);
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      date = next.toISOString().slice(0, 10);
    }
  }
  return uniq(nights);
}
function publicPeriod(period) {
  return {
    ...(period.id ? { id: period.id } : {}),
    period_key: period._period_key,
    start_date: period.start_date,
    end_date: period.end_date,
    arrival_time: period.arrival_time || null,
    departure_time: period.departure_time || null,
    notes: period.notes || null,
    status: 'ACTIVE',
  };
}
function periodChanges(current, proposed) {
  const changes = [];
  if (current.start_date !== proposed.start_date) changes.push('MOVED_START');
  if (current.end_date < proposed.end_date) changes.push('EXTENDED_END');
  if (current.end_date > proposed.end_date) changes.push('SHORTENED_END');
  if ((current.arrival_time || '') !== (proposed.arrival_time || '')) changes.push('ARRIVAL_TIME_CHANGED');
  if ((current.departure_time || '') !== (proposed.departure_time || '')) changes.push('DEPARTURE_TIME_CHANGED');
  return changes;
}
function error(code, details = {}) { return { code, ...details }; }

export async function authorizeActiveStayAdmin(base44, user) {
  const rows = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email }, '-created_date', 1);
  const internal = rows[0];
  const role = internal?.role || user.role;
  return user.role === 'admin' && !!internal?.active && ['SUPER_ADMIN', 'ADMIN'].includes(role);
}

export async function analyzeActiveMultiPeriodStayChange(base44, groupId, rawProposedPeriods, today = todayIL()) {
  const db = base44.asServiceRole.entities;
  const [groups, profiles, currentPeriods, allGroups, allProfiles, allPeriods, allAllocations, allReservations, settingsRows, holds, meals, scheduleItems, coffeeRequests, prisaRequests, tents] = await Promise.all([
    readAll(db.Group, { id: groupId }), readAll(db.OperationalGroupProfile, { group_id: groupId }),
    readAll(db.GroupStayPeriod, { group_id: groupId, status: 'ACTIVE' }),
    readAll(db.Group, { group_type: 'LODGING', status: { $in: ['CONFIRMED','COMPLETED'] } }),
    readAll(db.OperationalGroupProfile), readAll(db.GroupStayPeriod, { status: 'ACTIVE' }),
    readAll(db.SleepingAllocation, { status: { $in: ['DRAFT','CONFIRMED'] } }),
    readAll(db.NeighborhoodReservation, { status: 'ACTIVE' }), readAll(db.SiteSettings),
    readAll(db.OperationalHold, { status: 'ACTIVE' }),
    readAll(db.MealReservation, { group_id: groupId, status: 'ACTIVE' }),
    readAll(db.GroupScheduleItem, { group_id: groupId, status: 'ACTIVE' }),
    readAll(db.CoffeeCornerRequest, { group_id: groupId, status: 'ACTIVE' }),
    readAll(db.PrisaRequest, { group_id: groupId, status: 'ACTIVE' }), readAll(db.Tent),
  ]);

  const group = groups[0];
  const blockingErrors = [];
  const warnings = [];
  if (!group) blockingErrors.push(error('GROUP_NOT_FOUND'));
  if (group && group.stay_mode !== 'MULTI_PERIOD') blockingErrors.push(error('NOT_MULTI_PERIOD'));
  if (group && (group.status !== 'CONFIRMED' || group.operationally_active !== true)) blockingErrors.push(error('NOT_ACTIVE_CONFIRMED_MULTI_PERIOD'));
  if (profiles.length !== 1) blockingErrors.push(error('EXPECTED_EXACTLY_ONE_OGP', { profile_count: profiles.length }));

  const supplied = Array.isArray(rawProposedPeriods) ? rawProposedPeriods : [];
  const proposedWithKeys = supplied.map((period, index) => ({
    ...period,
    _period_key: period.id ? `id:${period.id}` : `new:${period.client_key || index}`,
    status: 'ACTIVE',
  }));
  const proposed = normalizeStayPeriods(proposedWithKeys).map(publicPeriod);
  const validation = validateStayPeriods(proposed);
  validation.errors.forEach(item => blockingErrors.push(item));
  if (proposed.length < 1) blockingErrors.push(error('ACTIVE_PERIODS_REQUIRED'));
  proposed.forEach((period, index) => {
    if (period.start_date >= period.end_date) blockingErrors.push(error('PERIOD_MUST_INCLUDE_SLEEPING_NIGHT', { index, period_key: period.period_key }));
  });

  const currentById = new Map(currentPeriods.map(period => [period.id, period]));
  const suppliedIds = proposed.map(period => period.id).filter(Boolean);
  if (new Set(suppliedIds).size !== suppliedIds.length) blockingErrors.push(error('DUPLICATE_PERIOD_IDS'));
  for (const id of suppliedIds) if (!currentById.has(id)) blockingErrors.push(error('INVALID_PERIOD_ID', { period_id: id }));

  const proposedById = new Map(proposed.filter(period => period.id).map(period => [period.id, period]));
  const addedPeriods = proposed.filter(period => !period.id);
  const removedPeriods = currentPeriods.filter(period => !proposedById.has(period.id));
  const changedPeriods = proposed.filter(period => period.id && currentById.has(period.id))
    .map(period => ({ current: currentById.get(period.id), proposed: period, changes: periodChanges(currentById.get(period.id), period) }))
    .filter(item => item.changes.length > 0);

  for (const item of [...removedPeriods.map(current => ({ current, proposed: null })), ...changedPeriods]) {
    const current = item.current;
    if (current.end_date <= today) blockingErrors.push(error('HISTORICAL_PERIOD_IMMUTABLE', { period_id: current.id, start_date: current.start_date, end_date: current.end_date }));
    else if (current.start_date < today && (!item.proposed || item.proposed.start_date !== current.start_date || item.proposed.end_date < today || (item.proposed.arrival_time || '') !== (current.arrival_time || ''))) {
      blockingErrors.push(error('STARTED_PERIOD_CANNOT_BE_REMOVED_OR_REWRITTEN', { period_id: current.id, start_date: current.start_date, end_date: current.end_date }));
    }
  }
  addedPeriods.filter(period => period.start_date < today).forEach(period => blockingErrors.push(error('NEW_PERIOD_CANNOT_START_IN_PAST', { period_key: period.period_key })));
  changedPeriods.filter(item => item.current.start_date >= today && item.proposed.start_date < today).forEach(item => blockingErrors.push(error('NEW_PERIOD_CANNOT_START_IN_PAST', { period_id: item.current.id })));
  if (new Set(proposed.map(p => p.period_key)).size !== proposed.length) blockingErrors.push(error('DUPLICATE_PERIOD_IDS'));
  if (group && group.group_type !== 'LODGING') blockingErrors.push(error('NOT_LODGING'));
  const base_version = await fingerprint(periodShape(currentPeriods));
  if (blockingErrors.length) return { result: { success: true, allowed: false, blocking_errors: blockingErrors, warnings: [], base_version }, plan: null };

  const currentNights = sleepingNights(currentPeriods);
  const proposedNights = sleepingNights(proposed);
  const addedNights = difference(proposedNights, currentNights);
  const removedNights = difference(currentNights, proposedNights);
  const currentArrivals = uniq(currentPeriods.map(period => period.start_date));
  const proposedArrivals = uniq(proposed.map(period => period.start_date));
  const currentCheckouts = uniq(currentPeriods.map(period => period.end_date));
  const proposedCheckouts = uniq(proposed.map(period => period.end_date));

  const myAllocations = allAllocations.filter(row => row.group_id === groupId && ACTIVE_ALLOCATION_STATUSES.has(row.status));
  const unlinkedAllocations = myAllocations.filter(row => !row.stay_period_id || !row.allocation_series_id);
  if (unlinkedAllocations.length) blockingErrors.push(error('LEGACY_SLEEPING_LINKAGE_REQUIRED', { allocation_ids: unlinkedAllocations.map(row => row.id) }));
  const logicalData = groupLogicalSleepingAssignments(myAllocations);
  const logical = logicalData.logical_assignments;
  // Missing coverage and segmented rows are valid. Identity/linkage corruption is not.
  if (logicalData.inconsistent_series.length) blockingErrors.push(error('INCOMPLETE_SLEEPING_SERIES'));
  if (myAllocations.some(row => row.departure_date > today && !currentById.has(row.stay_period_id))) blockingErrors.push(error('INVALID_SLEEPING_PERIOD_LINK'));
  const myReservations = allReservations.filter(row => row.group_id === groupId);
  if (myReservations.some(row => !row.stay_period_id)) blockingErrors.push(error('LEGACY_NEIGHBORHOOD_LINKAGE_REQUIRED'));
  const sleepingPlan = planStaySleeping({ groupId, current: currentPeriods, proposed, allocations: allAllocations, reservations: allReservations, logical, tents, today });
  const { allocationUpdates, allocationCreates, allocationCancels, reservationUpdates, reservationCreates, reservationCancels, exactTentConflicts } = sleepingPlan;
  const neighborhoodConflicts = sleepingPlan.neighborhoodImpacts;
  if (exactTentConflicts.length) warnings.push(error('SAME_TENT_CONFLICT', { conflicts: exactTentConflicts }));
  if (neighborhoodConflicts.length) warnings.push(error('NEIGHBORHOOD_CONFLICT'));

  const periodsByGroup = {};
  allPeriods.forEach(period => { (periodsByGroup[period.group_id] ||= []).push(period); });
  const profileByGroup = Object.fromEntries(allProfiles.map(profile => [profile.group_id, profile]));
  const maxSleepingPax = Number(settingsRows[0]?.max_sleeping_pax || 0);
  const requestedPax = Number(group?.total_pax || profiles[0]?.total_pax || 0);
  const capacityNights = [];
  for (const night of addedNights) {
    let existingPax = 0;
    const sources = [];
    const countedGroupIds = new Set();
    const nightEnd = nextDate(night);
    for (const other of allGroups) {
      if (other.id === groupId || other.group_type !== 'LODGING' || !ACTIVE_GROUP_STATUSES.has(other.status) || !isGroupOperationallyEnabled(other)) continue;
      const present = other.stay_mode === 'MULTI_PERIOD' ? occupiesSleepingNight(night, periodsByGroup[other.id] || []) : overlap(night, nightEnd, other.arrival_date, other.departure_date || other.arrival_date);
      if (!present) continue;
      countedGroupIds.add(other.id);
      const pax = Number(other.total_pax || profileByGroup[other.id]?.total_pax || 0);
      existingPax += pax; sources.push({ group_id: other.id, pax });
    }
    for (const hold of holds) {
      if (hold.group_type !== 'LODGING' || hold.group_id === groupId || (hold.group_id && countedGroupIds.has(hold.group_id))) continue;
      if (overlap(night, nightEnd, hold.arrival_date, hold.departure_date || hold.arrival_date)) existingPax += Number(hold.total_pax || 0);
    }
    const total = existingPax + requestedPax;
    const blocked = maxSleepingPax > 0 && total > maxSleepingPax;
    capacityNights.push({ night, existing_pax: existingPax, group_pax: requestedPax, total, capacity: maxSleepingPax, blocked, sources });
    if (blocked) warnings.push(error('SITE_SLEEPING_CAPACITY_EXCEEDED', { night, existing_pax: existingPax, group_pax: requestedPax, total, capacity: maxSleepingPax }));
  }
  if (addedNights.length && maxSleepingPax === 0) warnings.push({ code: 'SITE_SLEEPING_CAPACITY_UNCONFIGURED' });

  const currentStayDates = getOperationalStayDates(currentPeriods);
  const proposedStayDates = getOperationalStayDates(proposed);
  const mealCancellations = meals.filter(meal => meal.date >= today && !isDateInsideStayPeriods(meal.date, proposed));
  const newlyEligibleDates = difference(proposedStayDates, currentStayDates);
  const outside = rows => rows.filter(row => row.date >= today && !isDateInsideStayPeriods(row.date, proposed)).map(row => ({ id: row.id, date: row.date }));
  const activityWarnings = outside(scheduleItems);
  const coffeeWarnings = outside(coffeeRequests);
  const prisaWarnings = outside(prisaRequests);
  if (activityWarnings.length) warnings.push({ code: 'ACTIVITIES_IN_PROPOSED_GAP', count: activityWarnings.length });
  if (coffeeWarnings.length) warnings.push({ code: 'COFFEE_REQUESTS_IN_PROPOSED_GAP', count: coffeeWarnings.length });
  if (prisaWarnings.length) warnings.push({ code: 'PRISA_REQUESTS_IN_PROPOSED_GAP', count: prisaWarnings.length });

  const envelope = deriveStayEnvelope(proposed);
  const impacts = serviceImpacts({ current: currentPeriods, proposed, meals, scheduleItems, coffeeRequests, prisaRequests, today });
  impacts.push(...neighborhoodConflicts);
  capacityNights.filter(n => n.blocked).forEach(n => impacts.push({ module: 'CAPACITY', impact_type: 'EXCEEDED', date: n.night, summary: `חריגה מקיבולת האתר: ${n.total} מתוך ${n.capacity} מקומות`, metadata: n }));
  const uniqueImpacts = [...new Map(impacts.map(item => [`${item.module}:${item.impact_type}:${item.date}:${item.metadata?.record_id || item.metadata?.neighborhood_id || ''}`, item])).entries()].map(([key,item]) => ({ ...item, key }));
  const projected = allAllocations.filter(r => !allocationCancels.some(c => c.id === r.id)).map(r => ({ ...r, ...allocationUpdates.find(u => u.id === r.id) }));
  const coverageWithoutExtension = sleepingCoverage(group, profiles[0], proposed, projected, tents, null, today);
  const coverageWithExtension = sleepingCoverage(group, profiles[0], proposed, [...projected, ...allocationCreates.map((c,i) => ({ ...c.template, id: `planned:${i}` }))], tents, null, today);
  const result = {
    base_version,
    impacts: uniqueImpacts,
    sleeping_missing: coverageWithExtension,
    sleeping_missing_if_deferred: coverageWithoutExtension,
    success: true,
    allowed: blockingErrors.length === 0,
    blocking_errors: blockingErrors,
    warnings,
    period_diff: { added: addedPeriods, removed: removedPeriods.map(publicPeriod), changed: changedPeriods.map(item => ({ period_id: item.current.id, before: publicPeriod({ ...item.current, _period_key: `id:${item.current.id}` }), after: item.proposed, changes: item.changes })), added_sleeping_nights: addedNights, removed_sleeping_nights: removedNights },
    sleeping_impact: { logical_series_count: logical.length, same_tent_policy: true, rows_to_update: allocationUpdates.length, rows_to_create: allocationCreates.length, rows_to_cancel: allocationCancels.length, exact_tent_conflicts: exactTentConflicts },
    neighborhood_impact: { rows_to_update: reservationUpdates.length, rows_to_create: reservationCreates.length, rows_to_cancel: reservationCancels.length, conflicts: neighborhoodConflicts },
    capacity_impact: { configured_capacity: maxSleepingPax, added_nights: capacityNights },
    meal_impact: { cancellations: mealCancellations.map(meal => ({ id: meal.id, date: meal.date, meal_type: meal.meal_type })), newly_eligible_dates: newlyEligibleDates, automatic_creation: false, cancellation_mode: 'STATUS_CANCELLED' },
    housekeeping_impact: { new_preparation_dates: difference(proposedArrivals, currentArrivals), removed_preparation_dates: difference(currentArrivals, proposedArrivals), new_cleaning_dates: difference(proposedCheckouts, currentCheckouts), removed_cleaning_dates: difference(currentCheckouts, proposedCheckouts) },
    movement_impact: { added_check_ins: difference(proposedArrivals, currentArrivals), removed_check_ins: difference(currentArrivals, proposedArrivals), added_check_outs: difference(proposedCheckouts, currentCheckouts), removed_check_outs: difference(currentCheckouts, proposedCheckouts) },
    other_dated_children_impact: { activities: activityWarnings, coffee_corner_requests: coffeeWarnings, prisa_requests: prisaWarnings, action: 'WARNING_ONLY' },
    derived_envelope: envelope,
    historical_policy: { today, completed_periods_immutable: true, started_period_start_immutable: true },
  };
  const plan = { group, profile: profiles[0], currentPeriods, proposed, envelope, periodUpdates: changedPeriods.map(item => ({ id: item.current.id, period: item.proposed })), periodCreates: addedPeriods, periodCancels: removedPeriods, allocationUpdates, allocationCreates, allocationCancels, reservationUpdates, reservationCreates, reservationCancels, mealCancellations, allAllocations, allReservations, today, impacts: uniqueImpacts, base_version };
  return { result, plan };
}