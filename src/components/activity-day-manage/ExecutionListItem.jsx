import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Layers, Users } from "lucide-react";
import ManagementStateBadge, { resolveState } from "./ManagementStateBadge";
import { executionPath } from "@/lib/activityDayManageApi";

const fmtDate = (d) => (d ? d.split("-").reverse().join("/") : "");

export default function ExecutionListItem({ ex, today }) {
  return (
    <Link to={executionPath(ex.id)} className="activity-day-list-item block bg-card border border-border hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-primary tabular-nums">{fmtDate(ex.date)}</span>
            <span className="activity-day-template-name font-semibold text-foreground">{ex.template_name}</span>
            <span className="text-xs text-slate-400">גרסה {ex.template_version}</span>
            <ManagementStateBadge state={resolveState(ex, today)} />
            {ex.pending_operation && <span className="text-xs text-red-600">פעולה ממתינה</span>}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            <span className="flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> {ex.active_station_count}/{ex.station_count} תחנות פעילות</span>
            <span className="flex items-center gap-1 min-w-0"><Users className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{ex.group_names.join(", ") || "—"}</span></span>
          </div>
        </div>
        <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
      </div>
    </Link>
  );
}