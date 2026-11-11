import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Pencil } from "lucide-react";
import { isSelectable } from "@/lib/activityDayPlanning";

// Per-station group selection. Independent of other stations; a group may join parallel stations.
export default function StationGroupsEditor({ station, groups, onChange }) {
  const [open, setOpen] = useState(false);
  const selectable = groups.filter(isSelectable);
  const names = Object.fromEntries(groups.map(g => [g.id, g.group_name]));
  const toggle = (id) => onChange({ groups: station.groups.includes(id) ? station.groups.filter(x => x !== id) : [...station.groups, id] });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {station.groups.length === 0 && <span className="text-xs text-slate-400">לא נבחרו קבוצות</span>}
        {station.groups.map(id => (
          <span key={id} className="activity-day-chip inline-flex items-center gap-1 bg-primary/5 text-primary text-xs">
            {names[id] || "קבוצה"}
            <button onClick={() => toggle(id)} aria-label="הסר"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      {selectable.length > 0 && (
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-2 rounded-md px-2 text-sm text-primary hover:bg-primary/5">
          <Pencil className="w-3 h-3" /> {open ? "סגור עריכת קבוצות" : "ערוך קבוצות לתחנה זו"}
        </button>
      )}
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 rounded-lg border border-slate-100 p-2">
          {selectable.map(g => (
            <label key={g.id} className="activity-day-choice flex items-center gap-3 rounded-md border border-transparent px-2 py-2 hover:bg-muted cursor-pointer">
              <Checkbox checked={station.groups.includes(g.id)} onCheckedChange={() => toggle(g.id)} />
              <span className="text-sm text-foreground break-words">{g.group_name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}