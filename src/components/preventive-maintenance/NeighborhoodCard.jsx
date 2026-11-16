import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UNIT_STATE, formatDate } from "@/lib/preventiveMaintenanceLabels";

export default function NeighborhoodCard({ unit, canComplete, busy, onClean, onVoid }) {
  const meta = UNIT_STATE[unit.state];
  const hasRecord = unit.days_since != null;

  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2 ${meta.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm">{unit.label}</p>
          <span className={`inline-block mt-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${meta.badge}`}>{meta.label}</span>
        </div>
        {hasRecord && (
          <div className="text-center shrink-0">
            <p className="text-2xl font-bold leading-none">{unit.days_since}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">ימים</p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug min-h-[2.2em]">
        {hasRecord ? `ניקוי אחרון: ${formatDate(unit.last_completed_at)} · ${unit.last_completed_by}` : "אין ניקוי קודם במערכת"}
      </p>
      <Button size="sm" className="w-full h-10 gap-1.5" disabled={!canComplete || busy} onClick={onClean}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        סמן כנוקה
      </Button>
      {unit.can_void && (
        <button onClick={onVoid} className="text-[11px] text-muted-foreground hover:text-red-600 underline self-start">
          תיקון ניקוי אחרון
        </button>
      )}
    </div>
  );
}