import { CalendarDays } from "lucide-react";

const shortDate = value => {
  const [, month, day] = String(value || "").split("-");
  return day && month ? `${day}/${month}` : "";
};

export default function StayPeriodSelector({ periods, selectedId, onSelect, today }) {
  const periodState = period => period.end_date <= today
    ? "past"
    : period.start_date <= today ? "current" : "future";

  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2" aria-label="בחירת תקופת שהייה">
      <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
      <button type="button" onClick={() => onSelect(null)} className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold ${selectedId == null ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
        כל התקופות
      </button>
      {periods.map(period => {
        const state = periodState(period);
        const selected = selectedId === period.id;
        const stateClass = state === "past"
          ? "border-slate-200 bg-slate-100 text-slate-400"
          : state === "current"
            ? "border-emerald-400 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
        return (
          <button key={period.id} type="button" onClick={() => onSelect(period.id)} className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold ${selected ? "border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-200" : stateClass}`}>
            {shortDate(period.start_date)}–{shortDate(period.end_date)}
          </button>
        );
      })}
    </div>
  );
}