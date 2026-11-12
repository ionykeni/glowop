import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { PRESETS, presetRange, stepRange, fmtDate } from "@/lib/scheduleReportClient";

export default function ReportRangeControls({ preset, setPreset, range, setRange, workers, workerId, setWorkerId }) {
  const choose = (id) => { setPreset(id); if (id !== "custom") setRange(presetRange(id)); };
  return <div className="rounded-xl border bg-white p-3 sm:p-4 space-y-3">
    <div className="flex flex-wrap gap-1.5">
      {PRESETS.map((p) => <Button key={p.id} type="button" size="sm" variant={preset === p.id ? "default" : "outline"} onClick={() => choose(p.id)}>{p.label}</Button>)}
    </div>
    <div className="flex flex-wrap items-end gap-3">
      {preset === "custom" ? <>
        <label className="text-xs text-slate-500 space-y-1"><span>מתאריך</span><Input type="date" value={range.start} onChange={(e) => e.target.value && setRange({ ...range, start: e.target.value })} className="h-9 w-40" /></label>
        <label className="text-xs text-slate-500 space-y-1"><span>עד תאריך</span><Input type="date" value={range.end} onChange={(e) => e.target.value && setRange({ ...range, end: e.target.value })} className="h-9 w-40" /></label>
      </> : <div className="flex items-center gap-2">
        <Button type="button" size="icon" variant="outline" onClick={() => setRange(stepRange(preset, range, -1))} aria-label="הקודם"><ChevronRight /></Button>
        <span className="text-sm font-semibold tabular-nums min-w-44 text-center">{fmtDate(range.start)} – {fmtDate(range.end)}</span>
        <Button type="button" size="icon" variant="outline" onClick={() => setRange(stepRange(preset, range, 1))} aria-label="הבא"><ChevronLeft /></Button>
      </div>}
      <label className="text-xs text-slate-500 space-y-1">
        <span>עובד/ת</span>
        <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className="h-9 rounded-md border border-input bg-white px-2 text-sm min-w-44">
          <option value="ALL">כל צוות התפעול</option>
          {workers.map((w) => <option key={w.worker_id} value={w.worker_id}>{w.worker_name}</option>)}
        </select>
      </label>
    </div>
  </div>;
}