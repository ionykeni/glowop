import ShiftComparisonRow from "./ShiftComparisonRow";
import { fmtMinutes, fmtDay } from "@/lib/attendanceFormat";
import { SHIFT_HEADERS, extraDetails, workerNotes } from "./attendanceReportPresentation";

const summary = "cursor-pointer select-none rounded-xl px-3 py-2 font-semibold transition-colors hover:bg-cream-deep/60";

export default function WorkerComparison({ worker }) {
  const c = worker.comparison;
  const notes = workerNotes(worker);
  return (
    <div className="space-y-3">
      {notes.length > 0 && <div className="flex flex-wrap gap-1.5">{notes.map((n) => <span key={n} className="rounded-full bg-card px-3 py-1 text-[11px] text-muted-foreground ring-1 ring-warm-line/60">{n}</span>)}</div>}
      {c?.shifts.length ? (
        <div className="overflow-x-auto rounded-2xl bg-card ring-1 ring-warm-line/60" tabIndex={0} role="region" aria-label="פירוט משמרות">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="text-muted-foreground">
              <tr>{SHIFT_HEADERS.map((h, i) => <th key={h} scope="col" className={`px-3 py-2.5 font-medium first:ps-4 last:pe-4 ${i === SHIFT_HEADERS.length - 1 ? "text-end" : "text-start"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>{c.shifts.map((s) => <ShiftComparisonRow key={s.id} shift={s} />)}</tbody>
          </table>
        </div>
      ) : <p className="text-xs text-muted-foreground">אין משמרות מתוכננות בסידור המפורסם לתקופה זו.</p>}
      {!!c?.extra.length && (
        <details className="text-xs">
          <summary className={summary}>נוכחות מחוץ למשמרת מתוכננת ({c.extra.length})</summary>
          <ul className="mt-1 divide-y divide-warm-line/60 px-3">{c.extra.map((x) => {
            const e = extraDetails(x);
            return <li key={x.start_at} className="flex flex-wrap justify-between gap-x-2 py-2"><span>{e.date} · <bdi dir="ltr">{e.time}</bdi></span><span className="text-muted-foreground"><bdi dir="ltr">{e.duration}</bdi> · {e.label}</span></li>;
          })}</ul>
        </details>
      )}
      {worker.days.length > 0 && (
        <details className="text-xs">
          <summary className={summary}>סיכום לפי יום ({worker.days.length})</summary>
          <ul className="mt-1 divide-y divide-warm-line/60 px-3">{worker.days.map((d) => (
            <li key={d.date} className="flex flex-wrap justify-between gap-x-2 py-2"><span>{fmtDay(d.date)}</span><span className="tabular-nums">מאושר <bdi dir="ltr">{fmtMinutes(d.verified_minutes)}</bdi>{d.active_minutes > 0 && ` · פתוח ${fmtMinutes(d.active_minutes)}`}{d.unverified_minutes > 0 && <span className="text-amber-700"> · לא מאושר {fmtMinutes(d.unverified_minutes)}</span>}</span></li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}