import { liveSleeping, overlapSleeping } from './sleepingActionCore.js';
import { validateLinkedSeriesCompleteness } from './logicalSleepingSeries.js';

export const PAX_SCOPE = Object.freeze({ ONLY: 'SELECTED_ONLY', FORWARD: 'SELECTED_AND_FUTURE' });
const cleanRow = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['id','created_date','updated_date','created_by_id'].includes(key)));
const noteMarker = notes => String(notes || '').match(/__(?:vip_req_\d+|alt_tent)__/i)?.[0] || '';
const sameAssignment = (row, selected) => row.tent_id === selected.tent_id && row.allocation_type === selected.allocation_type && row.gender_group === selected.gender_group && noteMarker(row.notes) === noteMarker(selected.notes);

export function planScopedPaxChange(ctx, body) {
  const { group, periods, rows, tents, reservations, today } = ctx;
  const mode = body.edit_scope?.mode;
  const selectedPeriodId = body.edit_scope?.selected_period_id;
  if (!Object.values(PAX_SCOPE).includes(mode) || !selectedPeriodId) throw new Error('יש לבחור היקף שינוי');
  const selectedIndex = periods.findIndex(period => period.id === selectedPeriodId);
  if (selectedIndex < 0) throw new Error('תקופת השהייה לא נמצאה');
  const selectedPeriod = periods[selectedIndex];
  if (selectedPeriod.end_date <= today) throw new Error('לא ניתן לערוך תקופה שהסתיימה');
  const pax = Number(body.allocated_pax);
  if (!Number.isInteger(pax) || pax < 1) throw new Error('מספר האנשים חייב להיות מספר חיובי');

  const mine = rows.filter(row => row.group_id === group.id);
  const isScopedEditCandidate = row => liveSleeping(row) && row.departure_date > today;
  const selected = mine.find(row => row.id === body.allocation_id && isScopedEditCandidate(row) && row.stay_period_id === selectedPeriodId)
    || mine.find(row => row.allocation_series_id === body.allocation_series_id && isScopedEditCandidate(row) && row.stay_period_id === selectedPeriodId);
  if (!selected) throw new Error('השיבוץ בתקופה שנבחרה לא נמצא');
  const tent = tents.find(item => item.id === selected.tent_id);
  const operationalCapacity = tent && (tent.tent_type === 'VIP' || tent.is_accessible === true) ? Math.max(Number(tent.capacity || 0), 4) : Number(tent?.capacity || 0);
  if (!tent || tent.working_status !== 'WORKING' || pax > operationalCapacity) throw new Error('מספר האנשים גבוה מקיבולת האוהל');

  const affectedPeriods = mode === PAX_SCOPE.ONLY ? [selectedPeriod] : periods.slice(selectedIndex);
  const affectedRows = affectedPeriods.map(period => {
    const matches = mine.filter(row => isScopedEditCandidate(row) && row.stay_period_id === period.id && sameAssignment(row, selected));
    if (matches.length !== 1) throw new Error('לא נמצא שיבוץ יחיד בכל התקופות שנבחרו');
    return matches[0];
  });
  const startsAt = selectedPeriod.start_date < today ? today : selectedPeriod.start_date;
  const seriesId = crypto.randomUUID();
  const updates = [];
  const creates = affectedRows.map(row => {
    const arrival = row.arrival_date < startsAt ? startsAt : row.arrival_date;
    updates.push({ row, data: row.arrival_date < startsAt
      ? { departure_date: startsAt, segment_end_date: startsAt, series_action: 'REASSIGN', series_action_date: startsAt, replacement_series_id: seriesId }
      : { status: 'CANCELLED', series_action: 'REASSIGN', series_action_date: startsAt, replacement_series_id: seriesId } });
    return { ...cleanRow(row), arrival_date: arrival, allocated_pax: pax, allocation_series_id: seriesId, series_effective_from_period_id: selectedPeriodId, source_allocation_id: row.id, housekeeping_status: 'PENDING', series_action: undefined, series_action_date: undefined, replacement_series_id: undefined, segment_end_date: undefined, ...(arrival !== row.arrival_date ? { segment_start_date: arrival } : {}) };
  });

  if (mode === PAX_SCOPE.ONLY) {
    for (const period of periods.slice(selectedIndex + 1)) {
      const template = mine.find(row => isScopedEditCandidate(row) && row.stay_period_id === period.id && sameAssignment(row, selected));
      if (!template) throw new Error('לא ניתן לשמור את רצף התקופות שנבחר');
      creates.push({ ...cleanRow(template), status: 'CANCELLED', allocated_pax: pax, allocation_series_id: seriesId, series_effective_from_period_id: selectedPeriodId, series_action: 'RELEASE', series_action_date: selectedPeriod.end_date, replacement_series_id: undefined, source_allocation_id: selected.id });
    }
  }

  const replacedIds = new Set(updates.map(item => item.row.id));
  for (const replacement of creates.filter(row => row.status !== 'CANCELLED')) {
    const conflict = rows.find(other => liveSleeping(other) && !replacedIds.has(other.id) && other.tent_id === replacement.tent_id && overlapSleeping(replacement, other));
    if (conflict) throw new Error('האוהל תפוס בתאריכים שנבחרו');
  }
  const warnings = creates.filter(row => row.status !== 'CANCELLED').flatMap(replacement => reservations
    .filter(item => item.group_id !== group.id && item.neighborhood_id === replacement.neighborhood_id && overlapSleeping(replacement, item))
    .map(() => ({ code: 'SHARED_NEIGHBORHOOD', stay_period_id: replacement.stay_period_id })));
  const projected = mine.map(row => ({ ...row, ...updates.find(item => item.row.id === row.id)?.data })).concat(creates.map((row, index) => ({ ...row, id: `projected-${index}` })));
  const validation = validateLinkedSeriesCompleteness(projected, periods, group.id, today);
  if (!validation.valid) throw new Error('השינוי אינו שומר על רצף השיבוץ');
  return { updates, creates, warnings, affectedPeriods };
}