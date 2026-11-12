import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
import { WORKER_TEAMS } from "@/lib/workScheduleConfig";
import { fmtMinutes } from "@/lib/scheduleReportClient";
import ReportDayBreakdown from "@/components/work-schedule/reports/ReportDayBreakdown";

const TEAM = Object.fromEntries(WORKER_TEAMS.map((t) => [t.id, t.label]));
const Cells = ({ p, d }) => <>
  <td className="p-2.5 tabular-nums">{p.shift_count}</td>
  <td className="p-2.5 tabular-nums font-semibold">{fmtMinutes(p.planned_minutes)}</td>
  <td className="p-2.5 tabular-nums text-amber-700">{d.planned_minutes ? fmtMinutes(d.planned_minutes) : "—"}</td>
  <td className="p-2.5 tabular-nums">{p.on_call_count + d.on_call_count || "—"}</td>
  <td className="p-2.5 tabular-nums text-orange-600">{p.overlap_minutes ? fmtMinutes(p.overlap_minutes) : "—"}</td>
</>;

export default function ReportWorkerTable({ workers, team, showTeamRow }) {
  const [open, setOpen] = useState(null);
  if (!workers.length) return <div className="rounded-xl border bg-slate-50 p-8 text-center text-sm text-slate-500">אין משמרות משובצות בטווח שנבחר</div>;
  return <div className="rounded-xl border bg-white overflow-x-auto">
    <table className="w-full text-sm min-w-[640px]">
      <thead className="bg-slate-50 text-xs text-slate-500"><tr>
        <th className="p-2.5 text-right">עובד/ת</th><th className="p-2.5 text-right">משמרות</th><th className="p-2.5 text-right">שעות מתוכננות (פורסם)</th>
        <th className="p-2.5 text-right">טיוטה</th><th className="p-2.5 text-right">כונן לילה</th><th className="p-2.5 text-right">חפיפה</th>
      </tr></thead>
      <tbody>
        {workers.map((w) => <Fragment key={w.worker_id}>
          <tr className="border-t cursor-pointer hover:bg-slate-50" onClick={() => setOpen(open === w.worker_id ? null : w.worker_id)}>
            <td className="p-2.5"><div className="flex items-center gap-1.5"><ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open === w.worker_id ? "rotate-180" : ""}`} /><span className="font-medium">{w.worker_name}</span><span className="text-[11px] text-slate-400">{TEAM[w.team] || ""}</span></div></td>
            <Cells p={w.published} d={w.draft} />
          </tr>
          {open === w.worker_id && <tr className="bg-slate-50/70"><td colSpan={6} className="p-3"><ReportDayBreakdown worker={w} /></td></tr>}
        </Fragment>)}
        {showTeamRow && <tr className="border-t-2 bg-slate-50 font-semibold"><td className="p-2.5">סה״כ צוות</td><Cells p={team.published} d={team.draft} /></tr>}
      </tbody>
    </table>
  </div>;
}