import { Loader2 } from "lucide-react";
import { useRecordAudit } from "@/hooks/useAttendance";
import { fmtDateTime, fmtTime, CHANGE_LABELS } from "@/lib/attendanceFormat";

const span = (s, e) => (s ? `${fmtTime(s)} – ${e ? fmtTime(e) : "…"}` : "—");

export default function AuditTrail({ recordId }) {
  const { data, isLoading, error } = useRecordAudit(recordId);
  if (isLoading) return <div className="py-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  const o = data.original;
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2 text-xs">
      <p className="text-muted-foreground">
        {o.source === "MANUAL" ? "הרשומה נוספה ידנית." : <>החתמה מקורית: כניסה <b dir="ltr">{fmtTime(o.clock_in_at)}</b>{o.clock_out_at && <> · יציאה <b dir="ltr">{fmtTime(o.clock_out_at)}</b></>}</>}
        {o.auto_closed_at && <> · נסגר אוטומטית ע״י המערכת ({fmtDateTime(o.auto_closed_at)})</>}
      </p>
      {data.corrections.map((c) => (
        <div key={c.id} className="border-t border-border pt-2">
          <p className="font-semibold">
            {CHANGE_LABELS[c.change_type] || c.change_type}
            {c.state !== "APPLIED" && <span className="text-destructive"> ({c.state === "PENDING" ? "לא הושלם" : "לא נשמר — התנגשות"})</span>}
          </p>
          <p className="text-muted-foreground">{c.corrected_by_name}{c.by_manager ? " (מנהל)" : ""} · {fmtDateTime(c.corrected_at)}</p>
          {c.change_type !== "CREATE_MANUAL" && c.change_type !== "VOID" && (
            <p dir="ltr" className="text-end tabular-nums">{span(c.original_start_at, c.original_end_at)} ← {span(c.corrected_start_at, c.corrected_end_at)}</p>
          )}
          {c.change_type === "CREATE_MANUAL" && <p dir="ltr" className="text-end tabular-nums">{span(c.corrected_start_at, c.corrected_end_at)}</p>}
          {c.note && <p>הערה: {c.note}</p>}
        </div>
      ))}
    </div>
  );
}