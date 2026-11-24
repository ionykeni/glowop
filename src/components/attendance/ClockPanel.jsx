import { useMemo, useState } from "react";
import { Play, Square, Loader2 } from "lucide-react";
import ElapsedTimer from "./ElapsedTimer";
import ClockResultCard from "./ClockResultCard";
import PlannedShiftsNote from "./PlannedShiftsNote";
import AttendanceRow from "./AttendanceRow";
import { useClockAction } from "@/hooks/useAttendance";
import { fmtDay, fmtTime, localDate } from "@/lib/attendanceFormat";

function BigButton({ onClick, pending, stop, children }) {
  const Icon = pending ? Loader2 : stop ? Square : Play;
  return (
    <button type="button" onClick={onClick} disabled={pending}
      className={`flex h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-4 disabled:translate-y-0 disabled:opacity-60 ${stop
        ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/25 hover:shadow-xl hover:shadow-destructive/30 focus-visible:ring-destructive/25"
        : "bg-accent text-accent-foreground shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/30 focus-visible:ring-accent/25"}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20"><Icon className={`h-5 w-5 ${pending ? "animate-spin" : ""}`} /></span>
      {children}
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
      <div className="att-card relative overflow-hidden p-6 text-center sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-sage/80 to-transparent" />
        <div className="relative space-y-5">
          <div className="space-y-0.5">
            <p className="text-base font-semibold">{status.caller.name}</p>
            <p className="text-xs text-muted-foreground">היום בישראל · {fmtDay(status.today || localDate(status.server_now))}</p>
          </div>
          {active ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-full bg-card/80 px-3 py-1 text-xs font-semibold text-sage-foreground ring-1 ring-sage">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-accent" /></span>
                בעבודה מאז <bdi dir="ltr" className="tabular-nums">{fmtTime(active.start_at)}</bdi>
              </span>
              <ElapsedTimer startAt={active.start_at} dueAt={active.auto_close_due_at} offset={offset} />
              <BigButton stop pending={clock.isPending} onClick={() => press("clock_out")}>סיום עבודה</BigButton>
              <p className="text-[11px] text-muted-foreground">ללא סיום, הספירה תיעצר אוטומטית ב־{fmtTime(active.auto_close_due_at)} ותסומן לבדיקה</p>
            </>
          ) : (
            <>
              <span className="inline-flex rounded-full bg-card/80 px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-warm-line/60">לא בעבודה כרגע</span>
              <BigButton pending={clock.isPending} onClick={() => press("clock_in")}>התחלת עבודה</BigButton>
            </>
          )}
        </div>
      </div>
      {result && <ClockResultCard record={result} onClose={() => setResult(null)} />}
      <PlannedShiftsNote shifts={status.planned_today} />
      {status.today_records?.length > 0 && (
        <div className="att-card overflow-hidden">
          <p className="att-head">היום</p>
          <div className="att-divide">{status.today_records.map((r) => <AttendanceRow key={r.id} record={r} />)}</div>
        </div>
      )}
    </div>
  );
}