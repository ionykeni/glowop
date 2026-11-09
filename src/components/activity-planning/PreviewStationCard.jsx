import { MapPin, Users, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { LogisticsBadges } from "@/components/schedule/LogisticsFields";
import { STATUS_META } from "@/lib/activityDayPlanning";
import PlanStatusBadge from "./PlanStatusBadge";

export default function PreviewStationCard({ station }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800">{station.title || "ללא שם"}</p>
          <p className="text-xs text-slate-500 flex flex-wrap gap-x-3 mt-0.5">
            <span>{station.start_time}–{station.end_time}</span>
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{station.space_name || "ללא מרחב"}</span>
            <span className="flex items-center gap-1"><Users className="w-3 h-3" />{station.total_participants}{station.space_capacity ? ` / ${station.space_capacity}` : ""}</span>
          </p>
        </div>
        <PlanStatusBadge status={station.status} />
      </div>
      <LogisticsBadges item={station.logistics} />
      {station.groups.length > 0 && (
        <ul className="space-y-0.5">
          {station.groups.map(g => (
            <li key={g.group_id} className="text-xs flex items-start gap-1.5">
              {g.eligible ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />}
              <span className={g.eligible ? "text-slate-700" : "text-red-700 font-medium"}>
                {g.group_name} · {g.participants ?? "?"}{!g.eligible && ` — ${g.message}`}
                {g.notes.length > 0 && <span className="text-amber-700"> ({g.notes.join("; ")})</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {station.issues.length > 0 && (
        <ul className="space-y-0.5 border-t border-slate-100 pt-1.5">
          {station.issues.map((i, idx) => (
            <li key={idx} className="text-[11px] flex items-start gap-1.5 text-slate-600">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span><b>{STATUS_META[i.status]?.label}</b> — {i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}