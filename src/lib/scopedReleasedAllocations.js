const live = row => ["DRAFT", "CONFIRMED"].includes(row.status);
const marker = row => String(row.notes || "").match(/__(?:vip_req_\d+|alt_tent)__/i)?.[0] || "";

function connectedSeriesIds(rows, seed) {
  const ids = new Set([seed.allocation_series_id].filter(Boolean));
  const byId = new Map(rows.map(row => [row.id, row]));
  let changed = true;
  while (changed) {
    changed = false;
    rows.forEach(row => {
      const sourceSeries = byId.get(row.source_allocation_id)?.allocation_series_id;
      [row.allocation_series_id, row.replacement_series_id, sourceSeries].filter(Boolean).forEach(id => {
        if (ids.has(row.allocation_series_id) || ids.has(sourceSeries) || ids.has(row.replacement_series_id)) {
          if (!ids.has(id)) { ids.add(id); changed = true; }
        }
      });
    });
  }
  return ids;
}

export function releasedAllocationsForPeriod(rows, periodId, today) {
  const periodRows = rows.filter(row => row.stay_period_id === periodId);
  const referencedIds = new Set(periodRows.map(row => row.source_allocation_id).filter(Boolean));
  return periodRows.filter(row => {
    const supported = row.allocation_type === "STUDENT" || /__vip_req_\d+__/i.test(row.notes || "");
    if (!supported || row.series_action !== "RELEASE" || referencedIds.has(row.id)) return false;
    const seriesIds = connectedSeriesIds(rows, row);
    return !periodRows.some(other => live(other) && other.departure_date > today && seriesIds.has(other.allocation_series_id) && other.allocation_type === row.allocation_type && other.gender_group === row.gender_group && marker(other) === marker(row));
  });
}