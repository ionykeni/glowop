import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { fmtTime, fmtMinutes } from "@/lib/attendanceFormat";

export default function ClockResultCard({ record, onClose }) {
  const auto = record.display_status === "NEEDS_REVIEW";
  return (
    <div className={`rounded-2xl border p-4 ${auto ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {auto ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          <p className="font-bold">{auto ? "נסגר אוטומטית — דורש בדיקה" : "העבודה הסתיימה"}</p>
        </div>
        <button onClick={onClose} aria-label="סגירה" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div><p className="text-[11px] text-muted-foreground">התחלה</p><p className="font-semibold tabular-nums">{fmtTime(record.start_at)}</p></div>
        <div><p className="text-[11px] text-muted-foreground">סיום</p><p className="font-semibold tabular-nums">{fmtTime(record.end_at)}</p></div>
        <div><p className="text-[11px] text-muted-foreground">סה״כ</p><p className="font-bold tabular-nums">{fmtMinutes(record.worked_minutes)}</p></div>
      </div>
      {auto && <p className="text-xs text-red-700 mt-3">עברו 13 שעות מתחילת העבודה. יש לתקן את שעת הסיום בפועל בהיסטוריה.</p>}
    </div>
  );
}