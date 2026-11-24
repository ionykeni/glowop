import { useState } from "react";
import { Check, X, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRequestAction } from "@/hooks/useAttendance";
import { fmtDay, fmtDateTime, REQUEST_TYPE_LABELS } from "@/lib/attendanceFormat";
import RequestStatusBadge from "./RequestStatusBadge";
import RequestTimes from "./RequestTimes";

export default function RequestCard({ request: r, decided = false }) {
  const [note, setNote] = useState("");
  const m = useRequestAction();
  const act = (action) => m.mutate({ action, id: r.id, note });
  const busy = m.isPending || r.status === "APPROVING";
  return (
    <div className="px-5 py-4 space-y-2.5 transition-colors duration-150 hover:bg-cream/50">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{r.worker_name}</p>
          <p className="text-xs text-muted-foreground">{REQUEST_TYPE_LABELS[r.request_type]} · {fmtDay(r.local_date)} · נשלח {fmtDateTime(r.requested_at)}</p>
        </div>
        <RequestStatusBadge status={r.status} />
      </div>
      <RequestTimes request={r} />
      {r.note && <p className="text-xs">הערת העובד: {r.note}</p>}
      {decided ? (
        <p className="text-[11px] text-muted-foreground">{r.decided_by_name} · {fmtDateTime(r.decided_at)}{r.decision_note && ` — ${r.decision_note}`}</p>
      ) : (
        <>
          {r.outdated && <p className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />הרשומה השתנתה מאז הגשת הבקשה — אפשר רק לדחות</p>}
          {r.decision_error && !r.outdated && <p className="text-xs text-red-700">{r.decision_error}</p>}
          <Input placeholder="הסבר (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="h-9 rounded-xl border-warm-line bg-cream/60 text-sm" />
          <div className="flex gap-2">
            <Button size="sm" className="rounded-full bg-accent px-4 text-accent-foreground hover:bg-accent/90" onClick={() => act("approve_request")} disabled={busy || r.outdated}>{m.isPending && m.variables?.action === "approve_request" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}אישור</Button>
            <Button size="sm" variant="outline" className="rounded-full border-warm-line bg-card px-4 hover:bg-red-50 hover:text-red-600" onClick={() => act("reject_request")} disabled={busy}>{m.isPending && m.variables?.action === "reject_request" ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}דחייה</Button>
          </div>
        </>
      )}
    </div>
  );
}