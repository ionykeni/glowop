import React from "react";
import { Checkbox } from "@/components/ui/checkbox";

// Current participants are always listed (even if no longer eligible) so removal is always explicit.
// Groups present on the day can be added; eligibility is revalidated on the server.
export default function EditGroupsPicker({ current, dayGroups, selected, onChange }) {
  const currentIds = new Set(current.map(g => g.group_id));
  const options = [
    ...current.map(g => ({ id: g.group_id, name: g.group_name, note: "משתתפת כעת" })),
    ...dayGroups.filter(g => !currentIds.has(g.id)).map(g => ({ id: g.id, name: g.group_name, note: g.presence?.message || null, disabled: g.presence?.state === "UNVERIFIABLE" })),
  ];
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div className="activity-day-groups-picker border border-border rounded-lg max-h-56 overflow-y-auto divide-y divide-border">
      {options.map(o => (
        <label key={o.id} className={`activity-day-choice flex items-center gap-2 px-3 py-3 text-sm ${o.disabled ? "opacity-50" : "cursor-pointer hover:bg-slate-50"}`}>
          <Checkbox checked={selected.includes(o.id)} disabled={o.disabled && !selected.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
          <span className="flex-1 text-slate-800">{o.name}</span>
          {o.note && <span className="text-xs text-slate-400">{o.note}</span>}
        </label>
      ))}
      {options.length === 0 && <div className="p-3 text-sm text-slate-500">אין קבוצות באתר בתאריך זה</div>}
    </div>
  );
}