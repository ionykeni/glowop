import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import LogisticsFields from "@/components/schedule/LogisticsFields";

const NO_SPACE = "__none__";

export default function StationEditorCard({ station, index, total, spaces, errors, onChange, onMove, onRemove }) {
  const set = (k, v) => onChange({ [k]: v });
  return (
    <div className={`activity-day-station bg-card border rounded-xl p-4 space-y-3 ${errors.length ? "border-red-300" : "border-slate-200"}`}>
      <div className="activity-day-station-head items-center">
        <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center shrink-0">{index + 1}</span>
        <Input aria-label="שם הפעילות" value={station.title} onChange={e => set("title", e.target.value)} placeholder="שם הפעילות" className="flex-1 font-medium" />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="הזז למעלה"><ArrowUp className="w-4 h-4" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="הזז למטה"><ArrowDown className="w-4 h-4" /></button>
        <button type="button" onClick={onRemove} className="p-1.5 text-slate-300 hover:text-red-500" aria-label="הסר תחנה"><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="space-y-0.5"><label className="text-[11px] text-slate-500">שעת התחלה</label><Input type="time" value={station.start_time} onChange={e => set("start_time", e.target.value)} /></div>
        <div className="space-y-0.5"><label className="text-[11px] text-slate-500">שעת סיום</label><Input type="time" value={station.end_time} onChange={e => set("end_time", e.target.value)} /></div>
        <div className="col-span-2 space-y-0.5">
          <label className="text-[11px] text-slate-500">מרחב מוצע (המלצה בלבד, לא הזמנה)</label>
          <Select value={station.suggested_space_id || NO_SPACE} onValueChange={v => set("suggested_space_id", v === NO_SPACE ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SPACE}>ללא מרחב מוצע</SelectItem>
              {spaces.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Textarea rows={2} value={station.description} onChange={e => set("description", e.target.value)} placeholder="תיאור (אופציונלי)" className="text-sm" />
      <LogisticsFields value={station} onChange={onChange} />
      <Textarea rows={2} value={station.preparation_notes} onChange={e => set("preparation_notes", e.target.value)} placeholder="הערות הכנה" className="text-sm" />
      {errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e.message}</p>)}
    </div>
  );
}