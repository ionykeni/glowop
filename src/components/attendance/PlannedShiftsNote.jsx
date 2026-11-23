import { CalendarClock } from "lucide-react";

// Context only: the published planned shift never counts as worked time and is never changed by attendance.
export default function PlannedShiftsNote({ shifts }) {
  if (!shifts?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-start gap-2">
      <CalendarClock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="text-xs text-muted-foreground space-y-0.5">
        <p className="font-semibold text-foreground">המשמרת המתוכננת להיום</p>
        {shifts.map((s) => (
          <p key={s.id}>{s.row_label} {s.start_time && <span dir="ltr">{s.start_time}–{s.end_time}</span>}</p>
        ))}
      </div>
    </div>
  );
}