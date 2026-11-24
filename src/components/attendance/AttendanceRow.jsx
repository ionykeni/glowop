import { useState } from "react";
import { Pencil, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "./StatusBadge";
import CorrectionForm from "./CorrectionForm";
import AuditTrail from "./AuditTrail";
import PendingRequestNote from "./PendingRequestNote";
import { fmtDay, fmtTime, fmtMinutes, localDate } from "@/lib/attendanceFormat";

export default function AttendanceRow({ record, showWorker = false }) {
  const [mode, setMode] = useState(null);
  const toggle = (m) => setMode((cur) => (cur === m ? null : m));
  const nextDay = record.end_at && localDate(record.end_at) !== record.local_date;
  const hasHistory = record.correction_count > 0 || record.was_auto_closed || record.status === "VOIDED";

  return (
    <div className="px-5 py-4 space-y-2.5 transition-colors duration-150 hover:bg-cream/50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showWorker && <p className="text-sm font-bold">{record.worker_name}</p>}
          <p className={showWorker ? "text-xs text-muted-foreground" : "text-sm font-semibold"}>{fmtDay(record.local_date)}</p>
          <p className="text-sm tabular-nums">
            <span dir="ltr">{fmtTime(record.start_at)} – {record.end_at ? fmtTime(record.end_at) : "…"}</span>
            {nextDay && <span className="text-[11px] text-muted-foreground"> (למחרת)</span>}
            <span className="text-muted-foreground"> · סה״כ {fmtMinutes(record.worked_minutes)}</span>
          </p>
          {record.source === "MANUAL" && <p className="text-[11px] text-muted-foreground">נוסף ידנית</p>}
        </div>
        <StatusBadge status={record.display_status} />
      </div>
      {record.pending_request && <PendingRequestNote request={record.pending_request} />}
      <div className="flex gap-1.5">
        {record.status !== "VOIDED" && !record.pending_request && (
          <Button size="sm" variant={mode === "edit" ? "secondary" : "outline"} className="h-8 rounded-full border-warm-line bg-card hover:bg-sage hover:text-sage-foreground" onClick={() => toggle("edit")}>
            <Pencil className="w-3.5 h-3.5" />תיקון שעות
          </Button>
        )}
        {hasHistory && (
          <Button size="sm" variant="ghost" className="h-8 rounded-full text-muted-foreground hover:bg-cream-deep" onClick={() => toggle("audit")}>
            <History className="w-3.5 h-3.5" />היסטוריית שינויים
          </Button>
        )}
      </div>
      {mode === "edit" && <CorrectionForm record={record} onDone={() => setMode(null)} />}
      {mode === "audit" && <AuditTrail recordId={record.id} />}
    </div>
  );
}