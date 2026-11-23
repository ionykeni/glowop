import { fmtTime, fmtMinutes } from "@/lib/attendanceFormat";

const span = (s, e) => (s ? `${fmtTime(s)} – ${e ? fmtTime(e) : "…"}` : "—");
const total = (m) => (m === null || m === undefined ? "" : ` (${fmtMinutes(m)})`);

// Original vs requested times of a correction request.
export default function RequestTimes({ request: r }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="rounded-lg bg-muted/50 px-2 py-1.5">
        <p className="text-muted-foreground">שעות רשומות</p>
        <p className="font-semibold tabular-nums" dir="ltr">{r.request_type === "ADD" ? "—" : span(r.original_start_at, r.original_end_at)}{total(r.original_minutes)}</p>
      </div>
      <div className="rounded-lg bg-primary/5 px-2 py-1.5">
        <p className="text-muted-foreground">מבוקש</p>
        <p className="font-semibold tabular-nums" dir="ltr">{r.request_type === "VOID" ? "ביטול הרשומה" : `${span(r.requested_start_at, r.requested_end_at)}${total(r.requested_minutes)}`}</p>
      </div>
    </div>
  );
}