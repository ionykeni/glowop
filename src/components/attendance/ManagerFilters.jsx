import { ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/attendanceFormat";

const select = "h-10 w-full rounded-full border border-warm-line/70 bg-card px-4 text-sm shadow-sm shadow-warm-line/30 transition-colors hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export default function ManagerFilters({ date, onDate, workerId, onWorker, workers = [] }) {
  return (
    <div className="att-card p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" onClick={() => onDate(addDays(date, -1))} aria-label="יום קודם"><ChevronRight className="w-5 h-5" /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} />
        <Button size="icon" variant="ghost" onClick={() => onDate(addDays(date, 1))} aria-label="יום הבא"><ChevronLeft className="w-5 h-5" /></Button>
      </div>
      <WorkerSelect value={workerId} onChange={onWorker} workers={workers} allLabel="כל העובדים" />
    </div>
  );
}

export function WorkerSelect({ value, onChange, workers = [], allLabel, ariaLabel }) {
  return (
    <select className={select} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
    </select>
  );
}