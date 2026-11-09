import { Checkbox } from "@/components/ui/checkbox";
import { isSelectable } from "@/lib/activityDayPlanning";

const fmt = (d) => (d ? d.split("-").reverse().join("/") : "");

export default function EligibleGroupRow({ group, checked, onToggle }) {
  const selectable = isSelectable(group);
  const p = group.presence;
  return (
    <label className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${selectable ? "border-slate-200 bg-white cursor-pointer hover:border-primary/40" : "border-purple-200 bg-purple-50/50 cursor-not-allowed"}`}>
      <Checkbox checked={checked} disabled={!selectable} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-slate-800">{group.group_name}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {group.participant_count != null ? `${group.participant_count} משתתפים` : "כמות משתתפים לא ידועה"}
          {p.period && ` · שהייה ${fmt(p.period.start_date)}–${fmt(p.period.end_date)}`}
          {group.stay_mode === "MULTI_PERIOD" ? " · רב-תקופתי" : ""}
          {selectable && p.state === "PARTIAL" && ` · היום באתר ${p.from}–${p.to}`}
        </p>
        {!selectable && <p className="text-[11px] text-purple-700 mt-0.5">לא ניתן לאמת: {p.message}</p>}
        {group.participant_warning && <p className="text-[11px] text-amber-700 mt-0.5">{group.participant_warning}</p>}
      </div>
    </label>
  );
}