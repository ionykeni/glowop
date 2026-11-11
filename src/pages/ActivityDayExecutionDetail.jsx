import "@/components/activity-templates/activity-day-ui.css";
import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Loader2, CalendarDays, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import useExecutionManagement from "@/hooks/useExecutionManagement";
import { executionsListPath } from "@/lib/activityDayManageApi";
import { calendarLink } from "@/lib/activityDayExecution";
import ManagementStateBadge, { resolveState } from "@/components/activity-day-manage/ManagementStateBadge";
import ManagedStationCard from "@/components/activity-day-manage/ManagedStationCard";
import StationEditDialog from "@/components/activity-day-manage/StationEditDialog";
import CancelDialog from "@/components/activity-day-manage/CancelDialog";
import PendingOperationBanner from "@/components/activity-day-manage/PendingOperationBanner";
import OperationMessage from "@/components/activity-day-manage/OperationMessage";
import CalendarVerifyPanel from "@/components/activity-day-manage/CalendarVerifyPanel";
import ExecutionHistory from "@/components/activity-day-manage/ExecutionHistory";

export default function ActivityDayExecutionDetail() {
  const { id } = useParams();
  const { execution: ex, today, isLoading, error, run } = useExecutionManagement(id);
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(undefined); // undefined = closed, null = whole day, id = station
  const [message, setMessage] = useState(null);
  const editable = ex?.capabilities.editable && !ex.operation;

  return (
    <div className="activity-day-ui activity-day-page min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Link to={executionsListPath} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 w-fit">
          <ChevronRight className="w-4 h-4" /> לרשימת ימי הפעילות
        </Link>
        {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          : error || !ex ? <div className="text-center text-sm text-red-700 py-12">{error?.message || "יום הפעילות לא נמצא"}</div>
          : (
            <>
              <div className="activity-day-section flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold text-slate-800">{ex.template_name}</h1>
                    <span className="text-xs text-slate-400">גרסה {ex.template_version}</span>
                    <ManagementStateBadge state={resolveState(ex, today)} />
                  </div>
                  <div className="text-sm text-slate-600 mt-1">{ex.date.split("-").reverse().join("/")} · {ex.active_station_count}/{ex.station_count} תחנות פעילות</div>
                  {ex.last_modified_at && <div className="text-xs text-slate-400 mt-1">עודכן {new Date(ex.last_modified_at).toLocaleString("he-IL")}{ex.last_modified_by ? ` ע״י ${ex.last_modified_by}` : ""}</div>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button asChild size="sm" variant="outline"><Link to={calendarLink(ex.date)}><CalendarDays /> ביומן החדרים</Link></Button>
                  {editable && <Button size="sm" variant="outline" className="activity-day-danger" onClick={() => setCancelling(null)}><XCircle /> ביטול היום כולו</Button>}
                </div>
              </div>
              {!ex.capabilities.editable && <div className="text-sm text-slate-600 bg-slate-100 rounded-lg p-3">{ex.capabilities.reason}</div>}
              <PendingOperationBanner execution={ex} run={run} onMessage={setMessage} />
              <OperationMessage message={message} onClose={() => setMessage(null)} />
              <div className="space-y-2">
                {ex.stations.map(st => (
                  <ManagedStationCard key={st.station_id} station={st} editable={editable} onEdit={() => setEditing(st)} onCancel={() => setCancelling(st.station_id)} />
                ))}
              </div>
              <CalendarVerifyPanel executionId={ex.id} />
              <ExecutionHistory history={ex.history} stations={ex.stations} />
              {editing && <StationEditDialog execution={ex} station={editing} run={run} onClose={() => setEditing(null)} onMessage={setMessage} />}
              {cancelling !== undefined && <CancelDialog execution={ex} stationId={cancelling} run={run} onClose={() => setCancelling(undefined)} onMessage={setMessage} />}
            </>
          )}
      </div>
    </div>
  );
}