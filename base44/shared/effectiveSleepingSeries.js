import { normalizeStayPeriods } from './groupStayPeriods.js';

export function todayInJerusalem(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

export function expectedPeriodsForSeries(periods, effectivePeriodId, { seriesRows = [], todayDate } = {}) {
  const active = normalizeStayPeriods(periods).filter(period => period.status !== 'CANCELLED');
  const todayIL = todayDate || todayInJerusalem();
  const nonCancelledRows = seriesRows.filter(row => row.status !== 'CANCELLED');
  const isFullyHistorical = nonCancelledRows.length > 0 && nonCancelledRows.every(row => row.departure_date <= todayIL);
  const finalHistoricalDeparture = isFullyHistorical
    ? nonCancelledRows.reduce((latest, row) => String(row.departure_date) > latest ? String(row.departure_date) : latest, '')
    : null;
  const historicallyCapped = finalHistoricalDeparture
    ? active.filter(period => period.start_date <= finalHistoricalDeparture)
    : active;
  if (!effectivePeriodId) return { periods: historicallyCapped, error: null };
  const startIndex = active.findIndex(period => period.id === effectivePeriodId);
  if (startIndex < 0) return { periods: [], error: { code: 'INVALID_SERIES_EFFECTIVE_PERIOD', stay_period_id: effectivePeriodId } };
  const expected = active.slice(startIndex);
  return { periods: finalHistoricalDeparture ? expected.filter(period => period.start_date <= finalHistoricalDeparture) : expected, error: null };
}

export function readSeriesEffectivePeriod(rows = []) {
  const values = [...new Set(rows.map(row => row.series_effective_from_period_id || null))];
  if (values.length > 1) return { value: null, error: { code: 'SERIES_EFFECTIVE_MARKER_MISMATCH' } };
  return { value: values[0] || null, error: null };
}

export function preserveHistoricalPaxInPlan({ plan, existingAllocations = [], todayIL = todayInJerusalem() }) {
  const activeExisting = existingAllocations.filter(row => row.status !== 'CANCELLED');
  return {
    ...plan,
    planned_rows: plan.planned_rows.map(planned => {
      const row = planned.sleeping_allocation;
      if (row.departure_date > todayIL) return planned;
      const historical = activeExisting.find(existing =>
        existing.tent_id === row.tent_id &&
        existing.stay_period_id === planned.source_stay_period_id
      );
      if (!historical) return planned;
      return {
        ...planned,
        sleeping_allocation: { ...row, allocated_pax: Number(historical.allocated_pax) },
      };
    }),
  };
}

export function resolveAssignmentEffectivePeriods({ periods, assignments = [], existingAllocations = [], todayIL = todayInJerusalem() }) {
  const active = normalizeStayPeriods(periods).filter(period => period.status !== 'CANCELLED');
  const firstActionable = active.find(period => period.end_date > todayIL) || null;
  const activeRows = existingAllocations.filter(row => row.status !== 'CANCELLED' && row.allocation_series_id);
  const errors = [];
  const effectivePeriodIds = assignments.map((assignment, index) => {
    const rows = activeRows.filter(row => row.tent_id === assignment.tent_id);
    const seriesIds = [...new Set(rows.map(row => row.allocation_series_id))];
    if (seriesIds.length > 1) {
      errors.push({ code: 'AMBIGUOUS_EXISTING_TENT_SERIES', index, tent_id: assignment.tent_id });
      return null;
    }
    if (seriesIds.length === 1) {
      const marker = readSeriesEffectivePeriod(rows);
      if (marker.error) errors.push({ ...marker.error, index, allocation_series_id: seriesIds[0] });
      else if (marker.value && !active.some(period => period.id === marker.value)) errors.push({ code: 'INVALID_SERIES_EFFECTIVE_PERIOD', index, allocation_series_id: seriesIds[0], stay_period_id: marker.value });
      return marker.value;
    }
    if (!firstActionable) {
      errors.push({ code: 'NO_ACTIONABLE_STAY_PERIOD', index, tent_id: assignment.tent_id });
      return null;
    }
    return firstActionable.id;
  });
  return { valid: errors.length === 0, errors, effectivePeriodIds, firstActionablePeriodId: firstActionable?.id || null, todayIL };
}