import ShiftComparisonRow from "./ShiftComparisonRow";
import { fmtMinutes, fmtDay, fmtTime } from "@/lib/attendanceFormat";

const KIND = { verified: "מאושר", unverified: "נסגר אוטומטית — לא מאושר", active: "בעבודה כעת" };

// Per-shift detail of one worker: planned shifts against attendance, then attendance outside any planned shift.
export default function WorkerComparison({ comparison: c }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-muted-foreground">משמרות מתוכננות מול נוכחות</p>
      {c.shifts.length === 0 && <p className="text-xs text-muted-foreground">אין משמרות מתוכננות בסידור המפורסם לתקופה זו</p>}
      {c.shifts.map((s) => <ShiftComparisonRow key={s.id} shift={s} />)}
      {c.pending_count > 0 && <p className="text-[11px] text-amber-700">{c.pending_count} בקשות תיקון ממתינות לאישור — אינן כלולות בסיכומים עד לאישורן</p>}
      {c.extra.length > 0 && (
        <div className="rounded-xl border border-border bg-background px-3 py-2">
          <p className="text-xs font-bold mb-1">נוכחות מחוץ למשמרת מתוכננת</p>
          {c.extra.map((x) => (
            <div key={x.start_at} className="flex justify-between text-xs py-0.5">
              <span className="tabular-nums">{fmtDay(x.date)} · {fmtTime(x.start_at)}–{fmtTime(x.end_at)}</span>
              <span className="tabular-nums">{fmtMinutes(x.minutes)} · {KIND[x.kind]}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground mt-1">זמן זה כלול בשעות העבודה של העובד. הוא רק אינו משויך למשמרת בסידור.</p>
        </div>
      )}
    </div>
  );
}