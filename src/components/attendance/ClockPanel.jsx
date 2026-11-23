import { useMemo, useState } from "react";
import { Play, Square, Loader2 } from "lucide-react";
import ElapsedTimer from "./ElapsedTimer";
import ClockResultCard from "./ClockResultCard";
import PlannedShiftsNote from "./PlannedShiftsNote";
import AttendanceRow from "./AttendanceRow";
import { useClockAction } from "@/hooks/useAttendance";
import { fmtTime } from "@/lib/attendanceFormat";

function BigButton({ onClick, pending, stop, children }) {
  const Icon = pending ? Loader2 : stop ? Square : Play;
  return (
    <button onClick={onClick} disabled={pending}
      className={`w-full h-20 rounded-2xl text-xl font-bold flex items-center justify-center gap-3 shadow-sm transition-opacity disabled:opacity-60 ${stop ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
      <Icon className={`w-6 h-6 ${pending ? "animate-spin" : ""}`} />{children}
    </button>
  );
}

export default function ClockPanel({ status }) {
  const clock = useClockAction();
  const [result, setResult] = useState(null);
  const offset = useMemo(() => Date.parse(status.server_now) - Date.now(), [status.server_now]);
  const active = status.active;
  const press = (action) => clock.mutate(action, { onSuccess: (res) => setResult(action === "clock_out" ? res.record : null) });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 text-center space-y-4">
        <p className="text-sm text-muted-foreground">{status.caller.name}</p>
        {active ? (
          <>
            <p className="text-sm">התחלת עבודה ב-<span className="font-bold tabular-nums">{fmtTime(active.start_at)}</span></p>
            <ElapsedTimer startAt={active.start_at} dueAt={active.auto_close_due_at} offset={offset} />
            <BigButton stop pending={clock.isPending} onClick={() => press("clock_out")}>סיום עבודה</BigButton>
            <p className="text-[11px] text-muted-foreground">ללא סיום — הספירה תיעצר אוטומטית ב-{fmtTime(active.auto_close_due_at)} ותסומן לבדיקה</p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">לא בעבודה כרגע</p>
            <BigButton pending={clock.isPending} onClick={() => press("clock_in")}>התחלת עבודה</BigButton>
          </>
        )}
      </div>
      {result && <ClockResultCard record={result} onClose={() => setResult(null)} />}
      <PlannedShiftsNote shifts={status.planned_today} />
      {status.today_records?.length > 0 && (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
          <p className="px-4 py-2 text-xs font-semibold text-muted-foreground bg-muted/40">היום</p>
          {status.today_records.map((r) => <AttendanceRow key={r.id} record={r} />)}
        </div>
      )}
    </div>
  );
}