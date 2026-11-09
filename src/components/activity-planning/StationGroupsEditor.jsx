import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { isSelectable, localStationCheck } from "@/lib/activityDayPlanning";

export default function StationGroupsEditor({ station, groups, defaultCount, onChange }) {
  const selectable = groups.filter(isSelectable);
  if (selectable.length === 0) return <p className="text-xs text-slate-500">אין מכינות זכאיות לבחירה בתאריך זה.</p>;
  const toggle = (id) => {
    const next = { ...station.groups };
    if (id in next) delete next[id]; else next[id] = defaultCount(id);
    onChange({ groups: next });
  };
  const setCount = (id, v) => onChange({ groups: { ...station.groups, [id]: v } });
  return (
    <div className="space-y-1.5">
      {selectable.map(g => {
        const on = g.id in station.groups;
        const warn = on ? localStationCheck(g, station.start_time, station.end_time) : null;
        return (
          <div key={g.id} className={`flex items-center gap-2 rounded-md px-2 py-1 ${on ? "bg-primary/5" : ""}`}>
            <Checkbox checked={on} onCheckedChange={() => toggle(g.id)} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-700 truncate">{g.group_name}</p>
              {warn && <p className="text-[11px] text-red-600">{warn}</p>}
            </div>
            {on && (
              <Input type="number" min="0" value={station.groups[g.id]} onChange={e => setCount(g.id, e.target.value)}
                className="w-20 h-8 text-xs" aria-label="משתתפים" placeholder="כמות" />
            )}
          </div>
        );
      })}
    </div>
  );
}