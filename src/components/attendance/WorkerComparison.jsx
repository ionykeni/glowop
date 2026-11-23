import ShiftComparisonRow from "./ShiftComparisonRow";
import { fmtMinutes, fmtDay } from "@/lib/attendanceFormat";
import { SHIFT_HEADERS, extraDetails, workerNotes } from "./attendanceReportPresentation";

export default function WorkerComparison({ worker }) {
  const c = worker.comparison;
  const notes = workerNotes(worker);
  return (
    <div className="space-y-3">
      {c?.shifts.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card" tabIndex={0} role="region" aria-label="פירוט משמרות">
          <table className="w-full min-w-[370px] text-start text-xs">
            <thead className="bg-muted/40 text-muted-foreground"><tr>{SHIFT_HEADERS.map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{c.shifts.map((s) => <ShiftComparisonRow key={s.id} shift={s} />)}</tbody>
          </table>
        </div>
      ) : <p className="text-xs text-muted-foreground">אין משמרות מתוכננות בסידור המפורסם לתקופה זו.</p>}
      {notes.length > 0 && <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">{notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      {!!c?.extra.length && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">נוכחות מחוץ למשמרת מתוכננת ({c.extra.length})</summary>
          <ul className="mt-1 divide-y divide-border">{c.extra.map((x) => {
            const e = extraDetails(x);
            return <li key={x.start_at} className="flex flex-wrap justify-between gap-x-2 py-1.5"><span>{e.date} · <bdi dir="ltr">{e.time}</bdi></span><span><bdi dir="ltr">{e.duration}</bdi> · {e.label}</span></li>;
          })}</ul>
        </details>
      )}
      {worker.days.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">סיכום נוכחות לפי יום ({worker.days.length})</summary>
          <ul className="mt-1 divide-y divide-border">{worker.days.map((d) => (
            <li key={d.date} className="flex flex-wrap justify-between gap-x-2 py-1.5"><span>{fmtDay(d.date)}</span><span>מאושר: <bdi dir="ltr">{fmtMinutes(d.verified_minutes)}</bdi>{d.active_minutes > 0 && ` · פתוח: ${fmtMinutes(d.active_minutes)}`}{d.unverified_minutes > 0 && ` · לא מאושר: ${fmtMinutes(d.unverified_minutes)}`}</span></li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}