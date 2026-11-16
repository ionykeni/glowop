import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_OPTIONS, periodRange, rangeText, shiftWeek, fmtShareDate } from "@/lib/multiWeekShare";

export default function SharePeriodSelector({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const { range, error } = periodRange(value);
  const consecutive = ["2", "3", "4"].includes(value.mode);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <label className="block text-sm font-semibold text-slate-700">תקופה לשליחה</label>
      <select value={value.mode} onChange={(e) => set({ mode: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {consecutive && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => set({ startWeek: shiftWeek(value.startWeek, -1) })} aria-label="שבוע קודם"><ChevronRight /></Button>
          <span className="text-sm text-slate-700">שבוע התחלה: <b>{fmtShareDate(value.startWeek)}</b></span>
          <Button type="button" variant="outline" size="icon" onClick={() => set({ startWeek: shiftWeek(value.startWeek, 1) })} aria-label="שבוע הבא"><ChevronLeft /></Button>
        </div>
      )}
      {value.mode === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-600 space-y-1">מתאריך<Input type="date" value={value.customStart} onChange={(e) => set({ customStart: e.target.value })} /></label>
          <label className="text-xs text-slate-600 space-y-1">עד תאריך<Input type="date" value={value.customEnd} onChange={(e) => set({ customEnd: e.target.value })} /></label>
        </div>
      )}
      {value.mode !== "1" && (error
        ? <div className="text-xs text-destructive">{error}</div>
        : <div className="text-xs text-slate-500">טווח המסמך: <span dir="ltr">{rangeText(range)}</span></div>)}
    </div>
  );
}