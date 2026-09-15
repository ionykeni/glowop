const relevantRows = (rows, periodById, today) => rows.filter(row => row.status !== "CANCELLED" && row.departure_date > today && periodById.has(row.stay_period_id));

export function buildPeriodizedSleepingOverview(rows = [], periods = [], today) {
  const periodById = new Map(periods.map(period => [period.id, period]));
  const candidates = relevantRows(rows, periodById, today);
  const byId = new Map(rows.map(row => [row.id, row]));
  const parent = new Map();
  const find = value => { if (!parent.has(value)) parent.set(value, value); if (parent.get(value) !== value) parent.set(value, find(parent.get(value))); return parent.get(value); };
  const union = (a, b) => { if (!a || !b) return; const left = find(a), right = find(b); if (left !== right) parent.set(left, right); };
  rows.forEach(row => {
    const own = row.allocation_series_id || `row:${row.id}`;
    find(own);
    union(own, row.replacement_series_id);
    union(own, byId.get(row.source_allocation_id)?.allocation_series_id);
  });
  const groups = new Map();
  candidates.forEach(row => { const key = find(row.allocation_series_id || `row:${row.id}`); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
  return [...groups.entries()].map(([key, items]) => {
    const sorted = items.sort((a, b) => periodById.get(a.stay_period_id).start_date.localeCompare(periodById.get(b.stay_period_id).start_date));
    return { key, varied: new Set(sorted.map(row => `${row.tent_id}|${row.neighborhood_id}`)).size > 1, rows: sorted };
  });
}