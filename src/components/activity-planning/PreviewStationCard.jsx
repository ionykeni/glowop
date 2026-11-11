import { MapPin, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { LogisticsBadges } from "@/components/schedule/LogisticsFields";
import { STATUS_META } from "@/lib/activityDayPlanning";
import PlanStatusBadge from "./PlanStatusBadge";

export default function PreviewStationCard({ station }) {
  return (
    <div className="activity-day-station bg-card border border-border rounded-xl space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800">{station.title || "ללא שם"}</p>
          <p className="text-xs text-slate-500 flex flex-wrap gap-x-3 mt-0.5">
            <span>{station.start_time}–{station.end_time}</span>
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{station.space_name || "ללא מרחב"}</span>
          </p>
        </div>
        <PlanStatusBadge status={station.status} />
      </div>
      <LogisticsBadges item={station.logistics} />
      {station.groups.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {station.groups.map(g => (
            <li key={g.group_id} className={`text-xs inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${g.eligible ? "bg-slate-100 text-slate-700" : "bg-red-50 text-red-700"}`}>
              {g.eligible ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <XCircle className="w-3 h-3" />}
              {g.group_name}{!g.eligible && ` — ${g.message}`}
            </li>
          ))}
        </ul>
      )}
      {station.issues.length > 0 && (
        <ul className="space-y-0.5 border-t border-slate-100 pt-1.5">
          {station.issues.map((i, idx) => (
            <li key={idx} data-status={i.status} className="activity-day-issue text-xs flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span><b>{STATUS_META[i.status]?.label}</b> — {i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}