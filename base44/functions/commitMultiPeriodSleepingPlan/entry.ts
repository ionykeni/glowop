import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { addSleepingPlanConflicts, buildMultiPeriodSleepingPlan, findLegacyEnvelopeAllocations, normalizeSharedNeighborhoodIntent, validateSleepingAssignments } from '../../shared/multiPeriodSleepingPlan.js';
import { expectedPeriodsForSeries, readSeriesEffectivePeriod, resolveAssignmentEffectivePeriods } from '../../shared/effectiveSleepingSeries.js';
import '../../shared/logicalSleepingSeries.js';

function equivalentAssignment(row, assignment) {
  return row.tent_id === assignment.tent_id &&
    row.neighborhood_id === assignment.neighborhood_id &&
    Number(row.allocated_pax) === Number(assignment.allocated_pax) &&
    row.allocation_type === assignment.allocation_type &&
    row.gender_group === assignment.gender_group &&
    (row.notes || '') === (assignment.notes || '');
}

function inspectExistingState({ allocations, reservations, assignments, periods, plan }) {
  const linkedAllocations = allocations.filter(row => row.status !== 'CANCELLED' && (row.stay_period_id || row.allocation_series_id));
  const linkedReservations = reservations.filter(row => row.status === 'ACTIVE' && row.stay_period_id);
  if (linkedAllocations.length === 0 && linkedReservations.length === 0) return { state: 'NEW' };
  if (linkedAllocations.some(row => !row.stay_period_id || !row.allocation_series_id)) return { state: 'INCONSISTENT', reason: 'MISSING_ALLOCATION_LINKAGE' };

  const periodById = Object.fromEntries(periods.map(period => [period.id, period]));
  const bySeries = {};
  linkedAllocations.forEach(row => { (bySeries[row.allocation_series_id] ||= []).push(row); });
  const seriesGroups = Object.entries(bySeries);
  if (seriesGroups.length > assignments.length) return { state: 'INCONSISTENT', reason: 'SERIES_COUNT_MISMATCH' };

  const matchedTentIds = new Set();
  const matchedAssignmentIndexes = new Set();
  for (const [seriesId, rows] of seriesGroups) {
    const marker = readSeriesEffectivePeriod(rows);
    if (marker.error) return { state: 'INCONSISTENT', reason: 'SERIES_EFFECTIVE_MARKER_MISMATCH', allocation_series_id: seriesId };
    const expected = expectedPeriodsForSeries(periods, marker.value);
    if (expected.error) return { state: 'INCONSISTENT', reason: expected.error.code, allocation_series_id: seriesId, stay_period_id: marker.value };
    if (rows.length !== expected.periods.length) return { state: 'INCONSISTENT', reason: 'PARTIAL_SERIES', allocation_series_id: seriesId };
    const assignmentIndex = assignments.findIndex(item => item.tent_id === rows[0].tent_id);
    const assignment = assignments[assignmentIndex];
    if (!assignment || matchedTentIds.has(assignment.tent_id)) return { state: 'INCONSISTENT', reason: 'SERIES_ASSIGNMENT_MISMATCH', allocation_series_id: seriesId };
    matchedTentIds.add(assignment.tent_id);
    matchedAssignmentIndexes.add(assignmentIndex);
    const expectedIds = new Set(expected.periods.map(period => period.id));
    const periodIds = new Set();
    for (const row of rows) {
      const period = periodById[row.stay_period_id];
      if (!period || !expectedIds.has(row.stay_period_id) || periodIds.has(row.stay_period_id) || !equivalentAssignment(row, assignment) || row.arrival_date !== period.start_date || row.departure_date !== period.end_date) {
        return { state: 'INCONSISTENT', reason: 'SERIES_ROW_MISMATCH', allocation_series_id: seriesId, allocation_id: row.id };
      }
      periodIds.add(row.stay_period_id);
    }
    if ([...expectedIds].some(periodId => !periodIds.has(periodId))) return { state: 'INCONSISTENT', reason: 'PARTIAL_SERIES', allocation_series_id: seriesId };
  }

  const expectedNeighborhoods = plan.planned_neighborhood_intervals;
  const reservationKey = (stayPeriodId, neighborhoodId) => `${stayPeriodId || ''}:${neighborhoodId}`;
  const expectedByKey = new Map(expectedNeighborhoods.map(expected => [
    reservationKey(expected.source_stay_period_id, expected.neighborhood_reservation.neighborhood_id),
    expected,
  ]));
  const seenReservationKeys = new Set();
  for (const row of linkedReservations) {
    const key = reservationKey(row.stay_period_id, row.neighborhood_id);
    if (seenReservationKeys.has(key)) return { state: 'INCONSISTENT', reason: 'DUPLICATE_ACTIVE_NEIGHBORHOOD_PERIOD', stay_period_id: row.stay_period_id, neighborhood_id: row.neighborhood_id };
    seenReservationKeys.add(key);
    const expected = expectedByKey.get(key);
    const wanted = expected?.neighborhood_reservation;
    if (!wanted || row.arrival_date !== wanted.arrival_date || row.departure_date !== wanted.departure_date || row.gender_group !== wanted.gender_group || Number(row.planned_tents) !== Number(wanted.planned_tents)) {
      return { state: 'INCONSISTENT', reason: 'NEIGHBORHOOD_PERIOD_MISMATCH', stay_period_id: row.stay_period_id, neighborhood_id: row.neighborhood_id };
    }
  }
  if (seriesGroups.length === assignments.length) {
    if (linkedReservations.length === expectedNeighborhoods.length) {
      return { state: 'COMPLETE', allocation_series_ids: Object.keys(bySeries), allocation_ids: linkedAllocations.map(row => row.id), neighborhood_reservation_ids: linkedReservations.map(row => row.id) };
    }
    return { state: 'APPEND_RESERVATIONS', missing_assignment_indexes: [] };
  }
  const missingAssignmentIndexes = assignments.map((_, index) => index).filter(index => !matchedAssignmentIndexes.has(index));
  const appendIsVipOnly = missingAssignmentIndexes.every(index =>
    assignments[index].allocation_type === 'STAFF' && /__vip_req_\d+__/.test(assignments[index].notes || '')
  );
  const appendIsAltOnly = missingAssignmentIndexes.every(index =>
    assignments[index].allocation_type === 'STAFF' && (assignments[index].notes || '').includes('__alt_tent__')
  );
  const appendIsStudentOnly = missingAssignmentIndexes.every(index => assignments[index].allocation_type === 'STUDENT');
  if (appendIsVipOnly) return { state: 'APPEND_VIP', missing_assignment_indexes: missingAssignmentIndexes };
  if (appendIsAltOnly) return { state: 'APPEND_ALT', missing_assignment_indexes: missingAssignmentIndexes };
  if (appendIsStudentOnly) return { state: 'APPEND_STUDENT', missing_assignment_indexes: missingAssignmentIndexes };
  return { state: 'INCONSISTENT', reason: 'SERIES_COUNT_MISMATCH' };
}

async function rollbackCreated(base44, allocationIds, reservationIds) {
  const operations = [
    ...allocationIds.map(id => ({ type: 'SleepingAllocation', id, promise: base44.asServiceRole.entities.SleepingAllocation.delete(id) })),
    ...reservationIds.map(id => ({ type: 'NeighborhoodReservation', id, promise: base44.asServiceRole.entities.NeighborhoodReservation.delete(id) })),
  ];
  const results = await Promise.allSettled(operations.map(item => item.promise));
  const failed = results.flatMap((result, index) => result.status === 'rejected' ? [{ type: operations[index].type, id: operations[index].id, error: result.reason?.message || 'DELETE_FAILED' }] : []);
  return { attempted: operations.length, success: failed.length === 0, failed };
}

export default async function(req) {
  const createdAllocationIds = [];
  const createdReservationIds = [];
  let base44;
  try {
    base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const body = await req.json();
    const groupId = body?.group_id;
    const assignments = body?.assignments;
    const sharedNeighborhoods = body?.shared_neighborhoods;
    if (!groupId) return Response.json({ success: false, error: 'GROUP_ID_REQUIRED' }, { status: 400 });

    const group = await base44.asServiceRole.entities.Group.get(groupId).catch(() => null);
    if (!group) return Response.json({ success: false, error: 'GROUP_NOT_FOUND' }, { status: 404 });
    if (group.stay_mode !== 'MULTI_PERIOD') return Response.json({ success: false, error: 'GROUP_NOT_MULTI_PERIOD' }, { status: 409 });
    if (group.operationally_active !== true) return Response.json({ success: false, error: 'GROUP_NOT_OPERATIONALLY_ACTIVE' }, { status: 409 });
    if (group.status !== 'CONFIRMED') return Response.json({ success: false, error: 'GROUP_NOT_CONFIRMED' }, { status: 409 });

    const [profiles, periods, tents, inventoryNeighborhoods, activeAllocations, activeReservations] = await Promise.all([
      base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: groupId }),
      base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id: groupId, status: 'ACTIVE' }, 'start_date', 100),
      base44.asServiceRole.entities.Tent.list(),
      base44.asServiceRole.entities.Neighborhood.list(),
      base44.asServiceRole.entities.SleepingAllocation.filter({ status: { $in: ['DRAFT', 'CONFIRMED'] } }),
      base44.asServiceRole.entities.NeighborhoodReservation.filter({ status: 'ACTIVE' }),
    ]);
    if (profiles.length !== 1) return Response.json({ success: false, error: 'EXACTLY_ONE_OGP_REQUIRED', profile_count: profiles.length }, { status: 409 });
    const assignmentErrors = validateSleepingAssignments(assignments, tents, inventoryNeighborhoods);
    if (assignmentErrors.length > 0) return Response.json({ success: false, error: 'INVALID_ASSIGNMENTS', errors: assignmentErrors }, { status: 400 });
    const sharedIntent = normalizeSharedNeighborhoodIntent(sharedNeighborhoods, assignments);
    if (sharedIntent.errors.length > 0) return Response.json({ success: false, error: 'INVALID_SHARED_NEIGHBORHOODS', errors: sharedIntent.errors }, { status: 400 });

    const profile = profiles[0];
    const myAllocations = activeAllocations.filter(row => row.group_id === groupId);
    const effectiveResolution = resolveAssignmentEffectivePeriods({ periods, assignments, existingAllocations: myAllocations });
    if (!effectiveResolution.valid) return Response.json({ success: false, error: 'INVALID_SERIES_EFFECTIVE_PERIODS', errors: effectiveResolution.errors }, { status: 409 });
    const plan = buildMultiPeriodSleepingPlan({
      groupId,
      profileId: profile.id,
      periods,
      assignments,
      assignmentEffectivePeriodIds: effectiveResolution.effectivePeriodIds,
    });
    if (!plan.valid) return Response.json({ success: false, error: 'INVALID_ACTIVE_PERIODS', errors: plan.errors }, { status: 409 });
    const myReservations = activeReservations.filter(row => row.group_id === groupId);
    const legacyEnvelope = findLegacyEnvelopeAllocations(groupId, periods, activeAllocations);
    if (legacyEnvelope.length > 0) return Response.json({ success: false, error: 'LEGACY_ENVELOPE_ALLOCATION_REQUIRES_CONVERSION', legacy_allocations: legacyEnvelope.map(row => ({ id: row.id, tent_id: row.tent_id, arrival_date: row.arrival_date, departure_date: row.departure_date, status: row.status })) }, { status: 409 });
    const otherUnlinked = myAllocations.filter(row => !row.stay_period_id || !row.allocation_series_id);
    if (otherUnlinked.length > 0) return Response.json({ success: false, error: 'LEGACY_SLEEPING_ALLOCATION_REQUIRES_CONVERSION', allocation_ids: otherUnlinked.map(row => row.id) }, { status: 409 });
    const legacyReservations = myReservations.filter(row => !row.stay_period_id);
    if (legacyReservations.length > 0) return Response.json({ success: false, error: 'LEGACY_ENVELOPE_NEIGHBORHOOD_RESERVATION_REQUIRES_CONVERSION', reservation_ids: legacyReservations.map(row => row.id) }, { status: 409 });

    const existingState = inspectExistingState({ allocations: myAllocations, reservations: myReservations, assignments, periods, plan });
    if (existingState.state === 'COMPLETE') return Response.json({ success: true, runtime_build: 'MULTI_PERIOD_EFFECTIVE_20260830_V3', already_committed: true, read_only_retry: true, ...existingState });
    if (existingState.state === 'INCONSISTENT') return Response.json({ success: false, runtime_build: 'MULTI_PERIOD_EFFECTIVE_20260830_V3', error: 'INCONSISTENT_PERIODIZED_SLEEPING_STATE', details: existingState }, { status: 409 });

    const sharedNeighborhoodIds = [...new Set([
      ...myReservations.filter(row => row.shared_neighborhood_allowed === true).map(row => row.neighborhood_id),
      ...sharedIntent.sharedNeighborhoodIds,
    ])];
    const todayIL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const preview = addSleepingPlanConflicts({ plan, existingAllocations: activeAllocations, existingNeighborhoodReservations: activeReservations, sharedNeighborhoodIds, todayDate: todayIL });
    if (!preview.allowed) return Response.json({ success: false, runtime_build: 'MULTI_PERIOD_EFFECTIVE_20260830_V3', error: 'SLEEPING_PLAN_CONFLICT', exact_tent_conflicts: preview.exact_tent_conflicts, neighborhood_conflicts: preview.neighborhood_conflicts }, { status: 409 });

    const isAllocationAppend = ['APPEND_VIP', 'APPEND_ALT', 'APPEND_STUDENT', 'APPEND_RESERVATIONS'].includes(existingState.state);
    const indexesToCreate = isAllocationAppend
      ? new Set(existingState.missing_assignment_indexes || [])
      : new Set(assignments.map((_, index) => index));
    const seriesByAssignmentIndex = assignments.map((assignment, index) => indexesToCreate.has(index)
      ? { logical_assignment_index: index, tent_id: assignment.tent_id, allocation_series_id: crypto.randomUUID(), series_effective_from_period_id: effectiveResolution.effectivePeriodIds[index] || null }
      : null);
    for (const planned of plan.planned_rows.filter(row => indexesToCreate.has(row.logical_assignment_index))) {
      const series = seriesByAssignmentIndex[planned.logical_assignment_index];
      const created = await base44.asServiceRole.entities.SleepingAllocation.create({
        ...planned.sleeping_allocation,
        stay_period_id: planned.source_stay_period_id,
        allocation_series_id: series.allocation_series_id,
        ...(series.series_effective_from_period_id ? { series_effective_from_period_id: series.series_effective_from_period_id } : {}),
      });
      createdAllocationIds.push(created.id);
    }
    const existingReservationKeys = new Set(myReservations.map(row => `${row.stay_period_id || ''}:${row.neighborhood_id}`));
    const neighborhoodPlansToCreate = plan.planned_neighborhood_intervals.filter(planned =>
      !existingReservationKeys.has(`${planned.source_stay_period_id || ''}:${planned.neighborhood_reservation.neighborhood_id}`)
    );
    for (const planned of neighborhoodPlansToCreate) {
      const shared = sharedIntent.byNeighborhoodId[planned.neighborhood_reservation.neighborhood_id] || null;
      const created = await base44.asServiceRole.entities.NeighborhoodReservation.create({
        ...planned.neighborhood_reservation,
        stay_period_id: planned.source_stay_period_id,
        shared_neighborhood_allowed: !!shared,
        ...(shared ? {
          shared_neighborhood_reason: shared.reason,
          shared_neighborhood_approved_by: user.email,
          shared_neighborhood_approved_at: new Date().toISOString(),
        } : {}),
      });
      createdReservationIds.push(created.id);
    }

    return Response.json({
      success: true,
      runtime_build: 'MULTI_PERIOD_EFFECTIVE_20260830_V3',
      already_committed: false,
      group_id: groupId,
      operational_group_profile_id: profile.id,
      allocation_series: seriesByAssignmentIndex.filter(Boolean),
      appended_vip_only: existingState.state === 'APPEND_VIP',
      appended_alt_only: existingState.state === 'APPEND_ALT',
      appended_student_only: existingState.state === 'APPEND_STUDENT',
      sleeping_allocation_ids: createdAllocationIds,
      neighborhood_reservation_ids: createdReservationIds,
      sleeping_rows_created: createdAllocationIds.length,
      neighborhood_rows_created: createdReservationIds.length,
      same_tent_preserved: plan.same_tent_preserved,
      status: 'DRAFT',
    });
  } catch (error) {
    const cleanup = base44 ? await rollbackCreated(base44, createdAllocationIds, createdReservationIds) : { attempted: 0, success: true, failed: [] };
    return Response.json({ success: false, error: 'COMMIT_FAILED', message: error?.message || 'UNKNOWN_ERROR', cleanup }, { status: 500 });
  }
}