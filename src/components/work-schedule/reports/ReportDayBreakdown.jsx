import { fmtMinutes, fmtDate } from "@/lib/scheduleReportClient";

const ShiftChip = ({ it }) => <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${it.is_on_call ? "bg-cyan-50 border-cyan-200 text-cyan-800" : it.status === "draft" ? "bg-amber-50 border-amber-300 text-amber-900" : "bg-slate-50 border-slate-200 text-slate-700"}`}>
  {it.is_on_call ? "כונן לילה" : it.row_label}
  {it.start_time && <span className="tabular-nums" dir="ltr">{it.start_time}–{it.end_time}{it.overnight ? " (+1)" : ""}</span>}
  {it.status === "draft" && <b>טיוטה</b>}
</span>;

export default function ReportDayBreakdown({ worker }) {
  return <div className="space-y-2">
    {worker.weeks.length > 1 && <div className="flex flex-wrap gap-2 text-[11px]">
      {worker.weeks.map((w) => <span key={w.week_start} className="rounded-full bg-white border px-2 py-0.5">שבוע {fmtDate(w.week_start)}: <b className="tabular-nums">{fmtMinutes(w.published_minutes)}</b>{w.draft_minutes ? <span className="text-amber-700"> · טיוטה {fmtMinutes(w.draft_minutes)}</span> : null}</span>)}
    </div>}
    <table className="w-full text-xs bg-white rounded-lg border">
      <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2 text-right">תאריך</th><th className="p-2 text-right">משמרות</th><th className="p-2 text-right">שעות שפורסמו</th><th className="p-2 text-right">טיוטה</th></tr></thead>
      <tbody>{worker.days.map((d) => <tr key={d.date} className="border-t">
        <td className="p-2 whitespace-nowrap tabular-nums">{d.weekday} {fmtDate(d.date)}</td>
        <td className="p-2"><div className="flex flex-wrap gap-1">{d.items.map((it) => <ShiftChip key={it.id} it={it} />)}{!d.items.length && <span className="text-slate-400">המשך משמרת מהיום הקודם</span>}</div></td>
        <td className="p-2 tabular-nums">{d.published_minutes ? fmtMinutes(d.published_minutes) : "—"}</td>
        <td className="p-2 tabular-nums text-amber-700">{d.draft_minutes ? fmtMinutes(d.draft_minutes) : "—"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}