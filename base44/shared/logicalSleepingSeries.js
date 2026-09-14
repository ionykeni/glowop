import { expectedPeriodsForSeries, readSeriesEffectivePeriod } from './effectiveSleepingSeries.js';

function unique(rows, field, normalize = value => value) {
  return [...new Set(rows.map(row => normalize(row[field])))];
}

export function groupLogicalSleepingAssignments(rows = [], todayDate) {
  const activeRows = rows.filter(row => row.status !== 'CANCELLED');
  const todayIL = todayDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const buckets = new Map();
  activeRows.forEach((row, index) => {
    const linked = !!row.allocation_series_id;
    const key = linked ? `series:${row.allocation_series_id}` : `row:${row.id || index}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  });

  const logicalAssignments = [...buckets.entries()].map(([logicalKey, periodRows]) => {
    const linked = logicalKey.startsWith('series:');
    const errors = [];
    if (linked && periodRows.some(row => !row.stay_period_id || !row.allocation_series_id)) errors.push('MISSING_LINKAGE');
    if (unique(periodRows, 'tent_id').length !== 1) errors.push('TENT_MISMATCH');
    const actionableRows = periodRows.filter(row => row.departure_date > todayIL);
    if (unique(actionableRows, 'allocated_pax', Number).length > 1) errors.push('PAX_MISMATCH');
    if (unique(periodRows, 'allocation_type').length !== 1) errors.push('ALLOCATION_TYPE_MISMATCH');
    if (unique(periodRows, 'gender_group').length !== 1) errors.push('GENDER_MISMATCH');
    const effectiveMarker = readSeriesEffectivePeriod(periodRows);
    if (linked && effectiveMarker.error) errors.push('SERIES_EFFECTIVE_MARKER_MISMATCH');
    const statuses = unique(periodRows, 'status');
    const first = periodRows[0];
    const representative = actionableRows[0] || [...periodRows].sort((a, b) => String(b.departure_date).localeCompare(String(a.departure_date)))[0];
    return {
      logical_key: logicalKey,
      linked,
      allocation_series_id: linked ? first.allocation_series_id : null,
      series_effective_from_period_id: effectiveMarker.value,
      period_rows: periodRows,
      physical_row_count: periodRows.length,
      logical_allocated_pax: errors.includes('PAX_MISMATCH') ? null : Number(representative.allocated_pax || 0),
      tent_id: errors.includes('TENT_MISMATCH') ? null : first.tent_id,
      neighborhood_id: first.neighborhood_id,
      allocation_type: errors.includes('ALLOCATION_TYPE_MISMATCH') ? null : first.allocation_type,
      gender_group: errors.includes('GENDER_MISMATCH') ? null : first.gender_group,
      notes: representative.notes || '',
      statuses,
      status_summary: statuses.length === 1 ? statuses[0] : 'MIXED',
      all_confirmed: periodRows.every(row => row.status === 'CONFIRMED'),
      has_draft: periodRows.some(row => row.status === 'DRAFT'),
      inconsistent: errors.length > 0,
      consistency_errors: errors,
    };
  });

  return {
    logical_assignments: logicalAssignments,
    physical_row_count: activeRows.length,
    logical_assignment_count: logicalAssignments.length,
    inconsistent_series: logicalAssignments.filter(item => item.inconsistent),
  };
}

export function validateLinkedSeriesCompleteness(rows = [], activePeriods = [], groupId, todayDate) {
  const activeRows = rows.filter(row => row.status !== 'CANCELLED');
  const linkedRows = activeRows.filter(row => row.stay_period_id || row.allocation_series_id);
  if (linkedRows.length === 0) return { linked: false, valid: true, errors: [], ...groupLogicalSleepingAssignments(activeRows) };

  const errors = [];
  if (activeRows.some(row => !row.stay_period_id || !row.allocation_series_id)) errors.push({ code: 'MIXED_OR_MISSING_SERIES_LINKAGE' });
  const grouped = groupLogicalSleepingAssignments(linkedRows, todayDate);
  grouped.inconsistent_series.forEach(series => errors.push({ code: 'INCONSISTENT_LOGICAL_SERIES', allocation_series_id: series.allocation_series_id, details: series.consistency_errors }));
  const periodById = Object.fromEntries(activePeriods.map(period => [period.id, period]));

  grouped.logical_assignments.forEach(series => {
    if (series.consistency_errors.includes('SERIES_EFFECTIVE_MARKER_MISMATCH')) {
      errors.push({ code: 'SERIES_EFFECTIVE_MARKER_MISMATCH', allocation_series_id: series.allocation_series_id });
    }
    const expected = expectedPeriodsForSeries(activePeriods, series.series_effective_from_period_id);
    if (expected.error) errors.push({ ...expected.error, allocation_series_id: series.allocation_series_id });
    // An explicitly cancelled future row is a termination record, not missing coverage.
    const terminated = rows.filter(row => row.group_id === groupId && row.allocation_series_id === series.allocation_series_id && row.status === 'CANCELLED' && ['RELEASE', 'REASSIGN'].includes(row.series_action) && row.series_action_date && row.departure_date > row.series_action_date);
    const expectedIds = new Set(expected.periods.map(period => period.id));
    const seen = new Set(terminated.filter(row => expectedIds.has(row.stay_period_id)).map(row => row.stay_period_id));
    series.period_rows.forEach(row => {
      const period = periodById[row.stay_period_id];
      if (row.group_id !== groupId) errors.push({ code: 'SERIES_GROUP_MISMATCH', allocation_series_id: series.allocation_series_id, allocation_id: row.id });
      if (!period || period.group_id !== groupId) errors.push({ code: 'INVALID_STAY_PERIOD', allocation_series_id: series.allocation_series_id, stay_period_id: row.stay_period_id });
      if (seen.has(row.stay_period_id)) errors.push({ code: 'DUPLICATE_STAY_PERIOD', allocation_series_id: series.allocation_series_id, stay_period_id: row.stay_period_id });
      seen.add(row.stay_period_id);
      const validStart = period && (row.arrival_date === period.start_date || (row.segment_start_date === row.arrival_date && period.start_date <= row.arrival_date && row.arrival_date < period.end_date));
      const validEnd = period && (row.departure_date === period.end_date || (row.series_action === 'REASSIGN' && row.segment_end_date === row.departure_date && row.series_action_date === row.departure_date && period.start_date < row.departure_date && row.departure_date <= period.end_date));
      if (period && (!validStart || !validEnd || row.arrival_date >= row.departure_date)) errors.push({ code: 'PERIOD_DATE_MISMATCH', allocation_series_id: series.allocation_series_id, stay_period_id: row.stay_period_id });
    });
    expectedIds.forEach(periodId => {
      if (!seen.has(periodId)) errors.push({ code: 'MISSING_STAY_PERIOD', allocation_series_id: series.allocation_series_id, stay_period_id: periodId });
    });
    seen.forEach(periodId => {
      if (!expectedIds.has(periodId)) errors.push({ code: 'UNEXPECTED_STAY_PERIOD', allocation_series_id: series.allocation_series_id, stay_period_id: periodId });
    });
  });

  if (activePeriods.length === 0) errors.push({ code: 'ACTIVE_PERIODS_REQUIRED' });
  return { linked: true, valid: errors.length === 0, errors, ...grouped };
}