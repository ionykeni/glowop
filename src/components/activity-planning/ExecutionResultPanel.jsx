import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Loader2, CalendarRange, RefreshCw } from "lucide-react";
import { calendarLink } from "@/lib/activityDayExecution";

export default function ExecutionResultPanel({ execution, running, onResume, onCheck, onStartNew }) {
  const done = execution.state === "COMPLETED";
  const { counts, calendar_sync: sync } = execution;
  return (
    <section className={`rounded-xl border border-s-4 bg-card p-4 sm:p-5 space-y-4 ${done ? "border-green-300" : "border-amber-300"}`}>
      <div className="flex items-start gap-2">
        {done ? <CheckCircle2 className="w-5 h-5 text-green-700 shrink-0" /> : <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />}
        <div className="flex-1">
          <p className="font-bold text-slate-800">{done ? "יום הפעילות נוצר בהצלחה" : execution.state === "IN_PROGRESS" ? "היצירה בתהליך" : "היצירה הושלמה חלקית — נדרשת השלמה"}</p>
          <p className="text-xs text-slate-600">{execution.template_name} · גרסה {execution.template_version} · {execution.date} · {counts.completed_stations}/{counts.total_stations} תחנות · {counts.created_items}/{counts.expected_items} פעילויות קבוצה</p>
          {execution.last_error && !done && <p className="text-xs text-red-700 mt-1">{execution.last_error}</p>}
        </div>
      </div>
      <ul className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {execution.stations.map(s => (
          <li key={s.station_id} className="px-3 py-2 text-xs">
            <bdi dir="ltr" className="font-semibold">{s.start_time}–{s.end_time}</bdi> · {s.title || "ללא שם"} · {s.space_name}
            <span className="block text-slate-500">{s.groups.map(g => `${g.group_name}${g.item_id ? "" : " (חסר)"}`).join(", ")}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">Google Calendar: הסנכרון מתבצע ע״י האוטומציה הקיימת. נצפו {sync.observed} מתוך {sync.total} פעילויות מסונכרנות.</p>
      <div className="flex flex-wrap gap-2">
        {done && <Button asChild size="sm" className="gap-1.5"><Link to={calendarLink(execution.date)}><CalendarRange className="w-4 h-4" /> צפייה ביומן החזותי</Link></Button>}
        {!done && <Button size="sm" onClick={onResume} disabled={running} className="gap-1.5">{running && <Loader2 className="w-4 h-4 animate-spin" />} השלם יצירה</Button>}
        <Button size="sm" variant="outline" onClick={onCheck} disabled={running} className="gap-1.5"><RefreshCw className="w-4 h-4" /> רענן מצב</Button>
        {execution.state !== "IN_PROGRESS" && <Button size="sm" variant="ghost" onClick={onStartNew}>תכנון יום חדש</Button>}
      </div>
    </section>
  );
}