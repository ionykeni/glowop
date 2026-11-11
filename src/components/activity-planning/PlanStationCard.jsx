import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, RotateCcw } from "lucide-react";
import { LogisticsBadges } from "@/components/schedule/LogisticsFields";
import StationGroupsEditor from "./StationGroupsEditor";

const NO_SPACE = "__none__";

export default function PlanStationCard({ station, index, spaces, groups, onChange }) {
  if (station.removed) {
    return (
      <div className="flex items-center gap-2 border border-dashed border-slate-300 rounded-xl px-4 py-2 text-sm text-slate-400">
        <span className="flex-1 line-through">{index + 1}. {station.title || "תחנה"}</span>
        <button onClick={() => onChange({ removed: false })} className="flex items-center gap-1 text-xs text-primary"><RotateCcw className="w-3.5 h-3.5" /> החזר</button>
      </div>
    );
  }
  const set = (k, v) => onChange({ [k]: v });
  return (
    <div className="activity-day-station bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center shrink-0">{index + 1}</span>
        <Input aria-label="שם הפעילות" value={station.title} onChange={e => set("title", e.target.value)} className="flex-1 font-medium" />
        <button onClick={() => set("removed", true)} className="rounded-md p-2.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="הסר מהתוכנית בלבד (לא מהתבנית)" title="הסר מהתוכנית בלבד (לא מהתבנית)"><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="space-y-0.5"><label className="text-[11px] text-slate-500">התחלה</label><Input type="time" value={station.start_time} onChange={e => set("start_time", e.target.value)} /></div>
        <div className="space-y-0.5"><label className="text-[11px] text-slate-500">סיום</label><Input type="time" value={station.end_time} onChange={e => set("end_time", e.target.value)} /></div>
        <div className="col-span-2 space-y-0.5">
          <label className="text-[11px] text-slate-500">מרחב</label>
          <Select value={station.space_id || NO_SPACE} onValueChange={v => set("space_id", v === NO_SPACE ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SPACE}>ללא מרחב</SelectItem>
              {spaces.map(s => <SelectItem key={s.id} value={s.id}>{s.name}{!s.is_bookable || s.working_status !== "WORKING" ? " (לא זמין)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <LogisticsBadges item={station} />
      <div className="border-t border-slate-100 pt-2 space-y-1.5">
        <p className="text-xs font-semibold text-slate-600">קבוצות משתתפות ({station.groups.length})</p>
        <StationGroupsEditor station={station} groups={groups} onChange={onChange} />
      </div>
    </div>
  );
}