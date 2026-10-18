// Pure logic for the informational Mechina actual-sleeping report.
// Never touches operational entities.

export function buildSnapshot(rawEntries, tentMap, nbMap, assignedIds, draft = false) {
  const errors = [], entries = [], seen = new Set();
  if (!Array.isArray(rawEntries)) return { errors: ['רשימת אוהלים לא תקינה'], entries };
  for (const e of rawEntries) {
    const tent = tentMap[e.tent_id];
    if (!tent) { errors.push('אוהל מחוץ לתחום הדיווח'); continue; }
    if (seen.has(e.tent_id)) { errors.push(`אוהל ${tent.code} מופיע פעמיים`); continue; }
    seen.add(e.tent_id);
    if (e.boys !== undefined || e.girls !== undefined) { errors.push(`אוהל ${tent.code}: יש להשתמש בכמות ובמגדר אחד`); continue; }
    const count = e.count;
    if (!Number.isInteger(count) || count < 0 || count > tent.capacity) { errors.push(`אוהל ${tent.code}: יש להזין מספר שלם בין 0 ל-${tent.capacity}`); continue; }
    const gender = count === 0 ? '' : e.gender;
    if (count > 0 && !['BOYS', 'GIRLS'].includes(gender) && !(draft && !gender)) { errors.push(`אוהל ${tent.code}: יש לבחור בנים או בנות`); continue; }
    const boys = gender === 'BOYS' ? count : 0, girls = gender === 'GIRLS' ? count : 0;
    const assigned = assignedIds.has(e.tent_id);
    entries.push({ tent_id: e.tent_id, tent_code: tent.code, neighborhood_id: tent.neighborhood_id,
      neighborhood_name: nbMap[tent.neighborhood_id]?.name || '', capacity: tent.capacity,
      official_pax: tent.official_pax || 0, count, gender: gender || '', boys, girls, total: count,
      reported: e.reported === true || count > 0, assigned, note: String(e.note || '').slice(0, 500),
      warnings: !assigned && count > 0 ? ['NOT_ASSIGNED_TENT'] : [] });
  }
  const totals = entries.reduce((a, e) => ({ boys: a.boys + e.boys, girls: a.girls + e.girls, total: a.total + e.count }), { boys: 0, girls: 0, total: 0 });
  const byNeighborhood = {};
  for (const e of entries) {
    const k = e.neighborhood_name || '—';
    byNeighborhood[k] ||= { boys: 0, girls: 0, total: 0 };
    byNeighborhood[k].boys += e.boys; byNeighborhood[k].girls += e.girls; byNeighborhood[k].total += e.count;
  }
  return { errors, entries, totals, byNeighborhood };
}

export function compareSnapshots(prev, next) {
  if (!prev) return null;
  const prevMap = Object.fromEntries((prev.entries || []).map(e => [e.tent_id, e]));
  const nextMap = Object.fromEntries((next.entries || []).map(e => [e.tent_id, e]));
  const ids = new Set([...Object.keys(prevMap), ...Object.keys(nextMap)]);
  const tents = [];
  for (const id of ids) {
    const a = prevMap[id] || { boys: 0, girls: 0 };
    const b = nextMap[id] || { boys: 0, girls: 0 };
    if (a.boys !== b.boys || a.girls !== b.girls || (a.note || '') !== (b.note || '') || (a.reported || false) !== (b.reported || false)) {
      tents.push({ tent_id: id, tent_code: (b.tent_code || a.tent_code), prev_boys: a.boys, prev_girls: a.girls, boys: b.boys, girls: b.girls, prev_note: a.note || '', note: b.note || '' });
    }
  }
  return {
    prev_total: prev.totals.total, total: next.totals.total,
    prev_boys: prev.totals.boys, boys: next.totals.boys,
    prev_girls: prev.totals.girls, girls: next.totals.girls,
    changed_tents: tents,
    notes_changed: (prev.general_notes || '') !== (next.general_notes || ''),
  };
}