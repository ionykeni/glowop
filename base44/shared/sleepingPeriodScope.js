import { liveSleeping, overlapSleeping } from './sleepingActionCore.js';
import { validateLinkedSeriesCompleteness } from './logicalSleepingSeries.js';

export const PAX_SCOPE = Object.freeze({ ONLY: 'SELECTED_ONLY', FORWARD: 'SELECTED_AND_FUTURE' });
const cleanRow = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['id','created_date','updated_date','created_by_id'].includes(key)));
const noteMarker = notes => String(notes || '').match(/__(?:vip_req_\d+|alt_tent)__/i)?.[0] || '';
const sameAssignment = (row, selected) => row.tent_id === selected.tent_id && row.allocation_type === selected.allocation_type && row.gender_group === selected.gender_group && noteMarker(row.notes) === noteMarker(selected.notes);

const actionableScopedRows = (rows, today) => rows.filter(row => liveSleeping(row) && row.departure_date > today);

const connectedSeriesIds = (rows, seed) => {
  const ids = new Set([seed?.allocation_series_id].filter(Boolean));
  const byId = new Map(rows.map(row => [row.id, row]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const sourceSeries = byId.get(row.source_allocation_id)?.allocation_series_id;
      const links = [row.allocation_series_id, row.replacement_series_id, sourceSeries].filter(Boolean);
      if (links.some(id => ids.has(id))) for (const id of links) if (!ids.has(id)) { ids.add(id); changed = true; }
    }
  }
  return ids;
};

const sameLineageAssignment = (row, selected, seriesIds) => seriesIds.has(row.allocation_series_id) && row.allocation_type === selected.allocation_type && row.gender_group === selected.gender_group && noteMarker(row.notes) === noteMarker(selected.notes);

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

export function planScopedTentReassignment(ctx, body) {
  const { group, periods, rows, tents, reservations, today } = ctx;
  const mode = body.edit_scope?.mode;
  const selectedPeriodId = body.edit_scope?.selected_period_id;
  if (!Object.values(PAX_SCOPE).includes(mode) || !selectedPeriodId) throw new Error('יש לבחור היקף שינוי');
  const selectedIndex = periods.findIndex(period => period.id === selectedPeriodId);
  if (selectedIndex < 0) throw new Error('תקופת השהייה לא נמצאה');
  const selectedPeriod = periods[selectedIndex];
  if (selectedPeriod.end_date <= today) throw new Error('לא ניתן לערוך תקופה שהסתיימה');

  const mine = rows.filter(row => row.group_id === group.id);
  const actionable = actionableScopedRows(mine, today);
  const requested = mine.find(row => row.id === body.allocation_id)
    || mine.find(row => row.allocation_series_id === body.allocation_series_id && row.stay_period_id === selectedPeriodId);
  if (!requested) throw new Error('השיבוץ בתקופה שנבחרה לא נמצא');
  const lineageSeriesIds = connectedSeriesIds(mine, requested);
  const selectedMatches = actionable.filter(row => row.stay_period_id === selectedPeriodId && sameLineageAssignment(row, requested, lineageSeriesIds));
  if (selectedMatches.length !== 1) throw new Error('לא נמצא שיבוץ יחיד בתקופה שנבחרה');
  const selected = selectedMatches[0];

  const isVip = /__vip_req_\d+__/i.test(selected.notes || '');
  if (selected.allocation_type !== 'STUDENT' && !isVip) throw new Error('סוג השיבוץ אינו נתמך בשינוי מקום זה');
  const destination = tents.find(tent => tent.id === body.destination_tent_id);
  if (!destination || destination.working_status !== 'WORKING') throw new Error('אוהל היעד אינו זמין');
  if (destination.id === selected.tent_id) throw new Error('יש לבחור אוהל יעד שונה');
  if (isVip && destination.tent_type !== 'VIP') throw new Error('דרישת VIP חייבת להישאר באוהל VIP');
  if (selected.allocation_type === 'STUDENT' && destination.tent_type === 'VIP') throw new Error('שיבוץ חניכים חייב להישאר באוהל רגיל');
  const capacity = destination.tent_type === 'VIP' || destination.is_accessible === true ? Math.max(Number(destination.capacity || 0), 4) : Number(destination.capacity || 0);
  if (Number(selected.allocated_pax) > capacity) throw new Error('מספר האנשים גבוה מקיבולת אוהל היעד');

  const affectedPeriods = mode === PAX_SCOPE.ONLY ? [selectedPeriod] : periods.slice(selectedIndex);
  const affectedRows = affectedPeriods.map(period => {
    const matches = actionable.filter(row => row.stay_period_id === period.id && sameLineageAssignment(row, selected, lineageSeriesIds));
    if (matches.length !== 1) throw new Error('לא נמצא שיבוץ יחיד בכל התקופות שנבחרו');
    return matches[0];
  });
  const startsAt = selectedPeriod.start_date < today ? today : selectedPeriod.start_date;
  const replacementSeriesId = crypto.randomUUID();
  const updates = [];
  const creates = affectedRows.map(row => {
    const arrival = row.arrival_date < startsAt ? startsAt : row.arrival_date;
    const meta = { series_action: 'REASSIGN', series_action_date: startsAt, replacement_series_id: replacementSeriesId };
    updates.push({ row, data: row.arrival_date < startsAt ? { ...meta, departure_date: startsAt, segment_end_date: startsAt } : { ...meta, status: 'CANCELLED' } });
    return { ...cleanRow(row), tent_id: destination.id, neighborhood_id: destination.neighborhood_id, arrival_date: arrival, allocation_series_id: replacementSeriesId, series_effective_from_period_id: selectedPeriodId, source_allocation_id: row.id, housekeeping_status: 'PENDING', series_action: undefined, series_action_date: undefined, replacement_series_id: undefined, segment_end_date: undefined, ...(arrival !== row.arrival_date ? { segment_start_date: arrival } : {}) };
  });

  if (mode === PAX_SCOPE.ONLY) {
    for (const period of periods.slice(selectedIndex + 1)) {
      const matches = actionable.filter(row => row.stay_period_id === period.id && sameLineageAssignment(row, selected, lineageSeriesIds));
      if (matches.length !== 1) throw new Error('לא ניתן לשמור את רצף התקופות שנבחר');
      const template = matches[0];
      creates.push({ ...cleanRow(template), tent_id: destination.id, neighborhood_id: destination.neighborhood_id, status: 'CANCELLED', allocation_series_id: replacementSeriesId, series_effective_from_period_id: selectedPeriodId, series_action: 'RELEASE', series_action_date: selectedPeriod.end_date, replacement_series_id: undefined, source_allocation_id: selected.id });
    }
  }

  const replacedIds = new Set(updates.map(item => item.row.id));
  for (const replacement of creates.filter(row => row.status !== 'CANCELLED')) {
    const conflict = rows.find(other => liveSleeping(other) && !replacedIds.has(other.id) && other.tent_id === destination.id && overlapSleeping(replacement, other));
    if (conflict) throw new Error('אוהל היעד תפוס בתאריכים שנבחרו');
  }
  const warnings = creates.filter(row => row.status !== 'CANCELLED').flatMap(replacement => reservations
    .filter(item => item.group_id !== group.id && item.neighborhood_id === destination.neighborhood_id && overlapSleeping(replacement, item))
    .map(() => ({ code: 'SHARED_NEIGHBORHOOD', stay_period_id: replacement.stay_period_id })));
  const projected = mine.map(row => ({ ...row, ...updates.find(item => item.row.id === row.id)?.data })).concat(creates.map((row, index) => ({ ...row, id: `projected-location-${index}` })));
  if (!validateLinkedSeriesCompleteness(projected, periods, group.id, today).valid) throw new Error('השינוי אינו שומר על רצף השיבוץ');
  return { updates, creates, warnings, affectedPeriods };
}

export function planScopedRelease(ctx, body) {
  const { group, periods, rows, today } = ctx;
  const mode = body.edit_scope?.mode;
  const selectedPeriodId = body.edit_scope?.selected_period_id;
  if (!Object.values(PAX_SCOPE).includes(mode) || !selectedPeriodId) throw new Error('יש לבחור היקף שחרור');
  const selectedIndex = periods.findIndex(period => period.id === selectedPeriodId);
  if (selectedIndex < 0) throw new Error('תקופת השהייה לא נמצאה');
  const selectedPeriod = periods[selectedIndex];
  if (selectedPeriod.end_date <= today) throw new Error('לא ניתן לשחרר שיבוץ מתקופה שהסתיימה');

  const mine = rows.filter(row => row.group_id === group.id);
  const requested = mine.find(row => row.id === body.allocation_id)
    || mine.find(row => row.allocation_series_id === body.allocation_series_id && row.stay_period_id === selectedPeriodId);
  if (!requested) throw new Error('השיבוץ בתקופה שנבחרה לא נמצא');
  const lineageSeriesIds = connectedSeriesIds(mine, requested);
  const actionable = actionableScopedRows(mine, today);
  const selectedMatches = actionable.filter(row => row.stay_period_id === selectedPeriodId && sameLineageAssignment(row, requested, lineageSeriesIds));
  if (selectedMatches.length !== 1) throw new Error('לא נמצא שיבוץ יחיד בתקופה שנבחרה');
  const selected = selectedMatches[0];
  const isVip = /__vip_req_\d+__/i.test(selected.notes || '');
  if (selected.allocation_type !== 'STUDENT' && !isVip) throw new Error('סוג השיבוץ אינו נתמך בשחרור זה');

  const requestedPeriods = mode === PAX_SCOPE.ONLY ? [selectedPeriod] : periods.slice(selectedIndex);
  const affectedPeriods = [];
  const updates = requestedPeriods.flatMap(period => {
    const matches = actionable.filter(row => row.stay_period_id === period.id && sameLineageAssignment(row, selected, lineageSeriesIds));
    if (matches.length > 1) throw new Error('נמצאו שיבוצים כפולים באחת התקופות שנבחרו');
    if (!matches.length) return [];
    affectedPeriods.push(period);
    const row = matches[0];
    const releaseAt = period.id === selectedPeriodId && period.start_date < today ? today : period.start_date;
    const metadata = { series_action: 'RELEASE', series_action_date: releaseAt };
    return [{ row, data: row.arrival_date < releaseAt
      ? { ...metadata, departure_date: releaseAt, segment_end_date: releaseAt }
      : { ...metadata, status: 'CANCELLED' } }];
  });

  const projected = mine.map(row => ({ ...row, ...updates.find(item => item.row.id === row.id)?.data }));
  if (!validateLinkedSeriesCompleteness(projected, periods, group.id, today).valid) throw new Error('השחרור אינו שומר על רצף השיבוץ');
  return { updates, creates: [], warnings: [], affectedPeriods };
}

export function planScopedReAdd(ctx, body) {
  const { group, profile, periods, rows, tents, reservations, today } = ctx;
  const selectedPeriodId = body.edit_scope?.selected_period_id;
  const selectedIndex = periods.findIndex(period => period.id === selectedPeriodId);
  if (selectedIndex < 0) throw new Error('תקופת השהייה לא נמצאה');
  const selectedPeriod = periods[selectedIndex];
  if (selectedPeriod.end_date <= today) throw new Error('לא ניתן לשבץ מחדש תקופה שהסתיימה');

  const mine = rows.filter(row => row.group_id === group.id);
  const source = mine.find(row => row.id === body.allocation_id && row.stay_period_id === selectedPeriodId && row.series_action === 'RELEASE');
  if (!source) throw new Error('השיבוץ ששוחרר לא נמצא');
  if (mine.some(row => row.source_allocation_id === source.id && row.stay_period_id === selectedPeriodId)) throw new Error('השיבוץ כבר נוסף מחדש; יש לרענן');
  const isVip = /__vip_req_\d+__/i.test(source.notes || '');
  if (source.allocation_type !== 'STUDENT' && !isVip) throw new Error('סוג השיבוץ אינו נתמך בשיבוץ מחדש');

  const destination = tents.find(tent => tent.id === body.destination_tent_id);
  if (!destination || destination.working_status !== 'WORKING') throw new Error('אוהל היעד אינו זמין');
  if (isVip && destination.tent_type !== 'VIP') throw new Error('דרישת VIP חייבת להישאר באוהל VIP');
  if (source.allocation_type === 'STUDENT' && destination.tent_type === 'VIP') throw new Error('שיבוץ חניכים חייב להישאר באוהל רגיל');
  const capacity = destination.tent_type === 'VIP' || destination.is_accessible === true ? Math.max(Number(destination.capacity || 0), 4) : Number(destination.capacity || 0);
  if (Number(source.allocated_pax) > capacity) throw new Error('מספר האנשים גבוה מקיבולת אוהל היעד');

  const startsAt = selectedPeriod.start_date < today ? today : selectedPeriod.start_date;
  const replacement = {
    ...cleanRow(source), operational_group_profile_id: profile.id, tent_id: destination.id,
    neighborhood_id: destination.neighborhood_id, arrival_date: startsAt, departure_date: selectedPeriod.end_date,
    status: 'DRAFT', allocation_series_id: crypto.randomUUID(), series_effective_from_period_id: selectedPeriodId,
    source_allocation_id: source.id, housekeeping_status: 'PENDING', series_action: undefined,
    series_action_date: undefined, replacement_series_id: undefined, segment_end_date: undefined,
    ...(startsAt !== selectedPeriod.start_date ? { segment_start_date: startsAt } : {}),
  };
  const creates = [replacement];
  const sourceLineageIds = connectedSeriesIds(mine, source);
  for (const period of periods.slice(selectedIndex + 1)) {
    const template = mine.find(row => row.stay_period_id === period.id && sameLineageAssignment(row, source, sourceLineageIds));
    if (!template) throw new Error('לא ניתן לשמור את רצף התקופות לאחר השיבוץ מחדש');
    creates.push({ ...cleanRow(template), tent_id: destination.id, neighborhood_id: destination.neighborhood_id,
      status: 'CANCELLED', allocation_series_id: replacement.allocation_series_id,
      series_effective_from_period_id: selectedPeriodId, source_allocation_id: source.id,
      series_action: 'RELEASE', series_action_date: selectedPeriod.end_date, replacement_series_id: undefined });
  }

  const conflict = rows.find(other => liveSleeping(other) && other.tent_id === destination.id && overlapSleeping(replacement, other));
  if (conflict) throw new Error('האוהל תפוס בתאריכים שנבחרו');
  const warnings = reservations
    .filter(item => item.group_id !== group.id && item.neighborhood_id === destination.neighborhood_id && overlapSleeping(replacement, item))
    .map(() => ({ code: 'SHARED_NEIGHBORHOOD', stay_period_id: selectedPeriodId }));
  const projected = mine.concat(creates.map((row, index) => ({ ...row, id: `projected-readd-${index}` })));
  if (!validateLinkedSeriesCompleteness(projected, periods, group.id, today).valid) throw new Error('השיבוץ מחדש אינו שומר על רצף השיבוץ');
  return { updates: [], creates, warnings, affectedPeriods: [selectedPeriod] };
}