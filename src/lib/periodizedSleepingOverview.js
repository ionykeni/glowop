const shortDate = value => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const periodLabel = period => `${shortDate(period.start_date)}–${shortDate(period.end_date)}`;

function describeCoverage(periodIds, periods) {
  const covered = periods.filter(period => periodIds.has(period.id));
  if (!covered.length || covered.length === periods.length) return null;
  if (covered.length === 1) return { label: `${periodLabel(covered[0])} בלבד`, tone: "specific" };
  const indexes = covered.map(period => periods.findIndex(item => item.id === period.id));
  const isSuffix = indexes[indexes.length - 1] === periods.length - 1
    && indexes.every((value, index) => index === 0 || value === indexes[index - 1] + 1);
  return isSuffix
    ? { label: `מ־${shortDate(covered[0].start_date)} והלאה`, tone: "continuing" }
    : { label: covered.map(periodLabel).join(" + "), tone: "specific" };
}

function effectiveRows(rows, periods, today) {
  const periodById = new Map(periods.map(period => [period.id, period]));
  const byId = new Map(rows.map(row => [row.id, row]));
  const parent = new Map();
  const find = value => {
    if (!parent.has(value)) parent.set(value, value);
    if (parent.get(value) !== value) parent.set(value, find(parent.get(value)));
    return parent.get(value);
  };
  const union = (a, b) => {
    if (!a || !b) return;
    const left = find(a), right = find(b);
    if (left !== right) parent.set(left, right);
  };
  rows.forEach(row => {
    const own = row.allocation_series_id || `row:${row.id}`;
    find(own);
    union(own, row.replacement_series_id);
    union(own, byId.get(row.source_allocation_id)?.allocation_series_id);
  });
  const groups = new Map();
  rows.filter(row => row.status !== "CANCELLED" && periodById.has(row.stay_period_id)).forEach(row => {
    const key = `${find(row.allocation_series_id || `row:${row.id}`)}|${row.stay_period_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.values()].flatMap(items => {
    const period = periodById.get(items[0].stay_period_id);
    if (period.start_date <= today && today < period.end_date) return items.filter(row => row.departure_date > today);
    if (period.start_date > today) return items;
    return [items.sort((a, b) => (b.segment_start_date || b.arrival_date).localeCompare(a.segment_start_date || a.arrival_date))[0]];
  });
}

export function buildPeriodizedLocationCoverage(rows = [], periods = [], today) {
  const sortedPeriods = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const locations = {};
  effectiveRows(rows, sortedPeriods, today).forEach(row => {
    const neighborhood = locations[row.neighborhood_id] ||= { periodIds: new Set(), tents: {} };
    neighborhood.periodIds.add(row.stay_period_id);
    const tentPeriods = neighborhood.tents[row.tent_id] ||= new Set();
    tentPeriods.add(row.stay_period_id);
  });
  return Object.fromEntries(Object.entries(locations).map(([id, value]) => [id, {
    scope: describeCoverage(value.periodIds, sortedPeriods),
    tents: Object.entries(value.tents).map(([tent_id, periodIds]) => ({
      tent_id,
      scope: describeCoverage(periodIds, sortedPeriods),
    })),
  }]));
}