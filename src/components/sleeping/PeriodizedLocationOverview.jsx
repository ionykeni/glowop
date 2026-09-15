import { buildPeriodizedSleepingOverview } from "@/lib/periodizedSleepingOverview";

const shortDate = value => `${value.slice(8, 10)}/${value.slice(5, 7)}`;

export default function PeriodizedLocationOverview({ allocations, periods, tents, neighborhoods, today }) {
  const tentById = Object.fromEntries(tents.map(tent => [tent.id, tent]));
  const neighborhoodById = Object.fromEntries(neighborhoods.map(item => [item.id, item]));
  const items = buildPeriodizedSleepingOverview(allocations, periods, today);
  if (!items.length) return null;
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3" dir="rtl">
    <p className="mb-2 text-xs font-semibold text-slate-600">מיקום לפי תקופות</p>
    <div className="flex flex-wrap gap-2">
      {items.flatMap(item => {
        const visibleRows = item.varied ? item.rows : item.rows.slice(0, 1);
        return visibleRows.map(row => {
          const period = periods.find(value => value.id === row.stay_period_id);
          const tent = tentById[row.tent_id];
          const neighborhood = neighborhoodById[row.neighborhood_id];
          return <span key={`${item.key}-${row.stay_period_id}-${row.tent_id}`} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] text-blue-800">
            {neighborhood?.name && <span>{neighborhood.name} ·</span>}<strong>אוהל {tent?.code || "?"}</strong>{item.varied && period && <span className="rounded bg-white/80 px-1.5 py-0.5 font-semibold">{shortDate(period.start_date)}–{shortDate(period.end_date)}</span>}
          </span>;
        });
      })}
    </div>
  </div>;
}