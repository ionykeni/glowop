import { Check, Loader2 } from "lucide-react";
import { OCC_STATE, formatDateTime, periodText } from "@/lib/preventiveMaintenanceLabels";

export default function OccurrenceRow({ row, busy, onComplete, onVoid }) {
  const done = row.state === "COMPLETED";
  const meta = OCC_STATE[row.state];
  const box = done
    ? "bg-emerald-500 border-emerald-500 text-white"
    : row.can_complete ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-100";

  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${row.state === "OVERDUE" ? "bg-red-50/60" : ""}`}>
      <button
        type="button"
        onClick={onComplete}
        disabled={done || !row.can_complete || busy}
        aria-label="סמן כבוצע"
        className="shrink-0 w-11 h-11 -my-1.5 -mr-1.5 flex items-center justify-center disabled:cursor-default"
      >
        <span className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-colors ${box}`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : done ? <Check className="w-4 h-4" /> : null}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-snug ${done ? "text-slate-500" : "text-foreground"}`}>{row.title}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
          <span className={`px-2 py-0.5 rounded-full border font-semibold ${meta.cls}`}>{meta.label}</span>
          <span>אחריות: {row.responsible_label}</span>
          {row.state === "OVERDUE" && <span className="text-red-700">תקופה {periodText(row.period_start, row.period_end)}</span>}
        </div>
        {done && (
          <p className="text-xs text-emerald-700 mt-1">
            בוצע ע״י {row.completed_by_name} · {formatDateTime(row.completed_at)}{row.completed_late ? " · באיחור" : ""}
          </p>
        )}
        {!done && !row.can_complete && (
          <p className="text-[11px] text-muted-foreground mt-1">הסימון שמור לאחראי/ת המשימה ולמנהלים</p>
        )}
        {done && row.can_void && (
          <button onClick={onVoid} className="text-[11px] text-muted-foreground hover:text-red-600 underline mt-1">
            תיקון סימון שגוי
          </button>
        )}
      </div>
    </div>
  );
}