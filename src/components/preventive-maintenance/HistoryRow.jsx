import { formatDateTime, periodText } from "@/lib/preventiveMaintenanceLabels";

export default function HistoryRow({ ev, onVoid }) {
  const voided = ev.status === "VOIDED";
  return (
    <div className={`px-4 py-3 ${voided ? "bg-muted/50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-semibold leading-snug ${voided ? "line-through text-muted-foreground" : ""}`}>
            {ev.title}{ev.unit_label ? ` — ${ev.unit_label}` : ""}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDateTime(ev.completed_at)} · {ev.completed_by_name}{ev.on_behalf ? " (בשם האחראי)" : ""}
          </p>
          {ev.period_start && (
            <p className="text-[11px] text-muted-foreground">
              תקופה {periodText(ev.period_start, ev.period_end)}{ev.completed_late ? " · בוצע באיחור" : ""}
            </p>
          )}
        </div>
        <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${voided ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
          {voided ? "בוטל" : "תקין"}
        </span>
      </div>
      {voided && (
        <p className="text-[11px] text-red-700 mt-1">
          בוטל ע״י {ev.voided_by_name} · {formatDateTime(ev.voided_at)} · {ev.void_reason}
        </p>
      )}
      {ev.can_void && (
        <button onClick={onVoid} className="text-[11px] text-muted-foreground hover:text-red-600 underline mt-1">
          תיקון סימון שגוי
        </button>
      )}
    </div>
  );
}