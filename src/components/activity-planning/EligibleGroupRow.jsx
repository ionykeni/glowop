import { Checkbox } from "@/components/ui/checkbox";
import { isSelectable, GROUP_TYPE_LABELS } from "@/lib/activityDayPlanning";

const fmt = (d) => (d ? d.split("-").reverse().join("/") : "");

export default function EligibleGroupRow({ group, checked, onToggle }) {
  const selectable = isSelectable(group);
  const p = group.presence;
  const meta = [
    group.participant_count != null ? `${group.participant_count} משתתפים רשומים` : "כמות משתתפים לא ידועה",
    GROUP_TYPE_LABELS[group.group_type] || group.group_type,
    group.stay_mode === "MULTI_PERIOD" ? "רב-תקופתי" : null,
    p.period && p.period.start_date !== p.period.end_date ? `שהייה ${fmt(p.period.start_date)}–${fmt(p.period.end_date)}` : null,
    p.is_arrival && p.period?.start_date !== p.period?.end_date ? "יום הגעה" : null,
    p.is_departure && p.period?.start_date !== p.period?.end_date ? "יום עזיבה" : null,
  ].filter(Boolean);
  return (
    <label className={`activity-day-choice flex items-start gap-3 rounded-lg border px-3 py-3 ${selectable ? "border-slate-200 bg-white cursor-pointer hover:border-primary/40" : "border-purple-200 bg-purple-50/50 cursor-not-allowed"}`}>
      <Checkbox checked={checked} disabled={!selectable} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-slate-800">{group.group_name}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{meta.join(" · ")}</p>
        {!selectable && <p className="text-[11px] text-purple-700 mt-0.5">{p.message}</p>}
      </div>
    </label>
  );
}