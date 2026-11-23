import { fmtMinutes, fmtDay, fmtTime } from "@/lib/attendanceFormat";

const STATE = {
  RECORDED: { label: "יש רישום נוכחות", cls: "bg-emerald-50 text-emerald-700" },
  NO_RECORD: { label: "אין רישום שעון — לבדיקה", cls: "bg-amber-100 text-amber-800" },
  UPCOMING: { label: "טרם הסתיימה", cls: "bg-muted text-muted-foreground" },
  ON_CALL: { label: "כונן לילה — ללא השוואת שעות", cls: "bg-muted text-muted-foreground" },
  INVALID_TIMES: { label: "שעות המשמרת חסרות — לבדיקה", cls: "bg-amber-100 text-amber-800" },
};

// Exact minutes, no tolerance and no judgement: only where the clock stands relative to the planned time.
const diffText = (n, edge) => (n === 0 ? `בדיוק ב${edge}` : `${Math.abs(n)} דק׳ ${n > 0 ? "אחרי" : "לפני"} ${edge}`);

function Edge({ title, time, text }) {
  return <p className="text-xs"><span className="text-muted-foreground">{title} </span><span className="tabular-nums font-semibold">{time}</span> · {text}</p>;
}

export default function ShiftComparisonRow({ shift: s }) {
  const meta = STATE[s.state];
  const first = s.sessions?.[0], last = s.sessions?.[s.sessions.length - 1];
  const tags = [
    s.pending_correction && "בקשת תיקון ממתינה לאישור",
    s.unverified_minutes > 0 && `${fmtMinutes(s.unverified_minutes)} נסגר אוטומטית — לא מאושר`,
    s.active_minutes > 0 && `${fmtMinutes(s.active_minutes)} בעבודה כעת`,
    s.overlaps_other_shift && "חופפת למשמרת אחרת — הזמן נספר פעם אחת",
    s.starts_before_period && "התחילה לפני תחילת התקופה",
  ].filter(Boolean);
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{fmtDay(s.date)} · {s.row_label}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
      </div>
      {!s.is_on_call && (
        <p className="text-xs text-muted-foreground tabular-nums">
          מתוכנן {s.start_time || "—"}–{s.end_time || "—"} ({fmtMinutes(s.planned_minutes)})
          {s.state === "RECORDED" && <span className="text-foreground"> · מאושר בתוך המשמרת {fmtMinutes(s.verified_minutes)}</span>}
        </p>
      )}
      {s.state === "RECORDED" && (
        <>
          <Edge title="כניסה" time={fmtTime(first.start_at)} text={s.arrival_continuous ? "המשך רצוף מהמשמרת הקודמת" : diffText(s.arrival_diff_minutes, "תחילת המשמרת")} />
          <Edge title="יציאה" time={fmtTime(last.end_at)} text={s.departure_kind === "active" ? "עדיין בעבודה" : s.departure_kind === "unverified" ? "שעת היציאה לא מאושרת" : s.departure_continuous ? "המשך רצוף למשמרת הבאה" : diffText(s.departure_diff_minutes, "סוף המשמרת")} />
          {s.sessions.length > 1 && <p className="text-[11px] text-muted-foreground tabular-nums">{s.sessions.length} רישומים: {s.sessions.map((x) => `${fmtTime(x.start_at)}–${fmtTime(x.end_at)}`).join(" · ")}</p>}
        </>
      )}
      {tags.length > 0 && <p className="text-[11px] text-amber-700">{tags.join(" · ")}</p>}
    </div>
  );
}