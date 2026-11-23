import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { fmtMinutes, fmtDay } from "@/lib/attendanceFormat";

export default function ReportWorkerRow({ worker: w }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="w-full px-4 py-3 flex items-center justify-between gap-2 text-start hover:bg-muted/30">
        <div className="min-w-0">
          <p className="text-sm font-bold">{w.worker_name}</p>
          <p className="text-xs text-muted-foreground">
            {w.session_count} רשומות · {w.days.length} ימי נוכחות
            {w.corrected_count > 0 && <span className="text-amber-700"> · {w.corrected_count} תוקנו</span>}
            {w.auto_closed_count > 0 && <span className="text-red-600"> · {w.auto_closed_count} נסגרו אוטומטית</span>}
          </p>
        </div>
        <div className="text-end shrink-0">
          <p className="text-lg font-bold tabular-nums">{fmtMinutes(w.verified_minutes)}</p>
          {w.unverified_minutes > 0 && <p className="text-[11px] text-red-600 tabular-nums">+{fmtMinutes(w.unverified_minutes)} לא מאושר</p>}
          {w.active_minutes > 0 && <p className="text-[11px] text-primary tabular-nums">+{fmtMinutes(w.active_minutes)} בעבודה כעת</p>}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {w.days.map((d) => (
            <div key={d.date} className="flex justify-between text-xs border-b border-border/60 py-1">
              <span>{fmtDay(d.date)}</span>
              <span className="tabular-nums">
                {fmtMinutes(d.verified_minutes + d.active_minutes)}
                {d.unverified_minutes > 0 && <span className="text-red-600"> · {fmtMinutes(d.unverified_minutes)} לא מאושר</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}