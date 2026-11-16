import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import PmHeader from "@/components/preventive-maintenance/PmHeader";
import PmTasksView from "@/components/preventive-maintenance/PmTasksView";
import MaintenanceHistory from "@/components/preventive-maintenance/MaintenanceHistory";
import TaskDefinitionsPanel from "@/components/preventive-maintenance/TaskDefinitionsPanel";
import VoidCompletionDialog from "@/components/preventive-maintenance/VoidCompletionDialog";
import { usePmOverview } from "@/hooks/usePreventiveMaintenance";

export default function PreventiveMaintenance() {
  const [tab, setTab] = useState("tasks");
  const [voidTarget, setVoidTarget] = useState(null);
  const { data, isLoading, error } = usePmOverview();
  const isManager = !!data?.caller?.is_manager;

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        <PmHeader data={data} tab={tab} onTab={setTab} isManager={isManager} />
        {isLoading && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error.message}
          </div>
        )}
        {data && tab === "tasks" && <PmTasksView data={data} onVoid={setVoidTarget} />}
        {data && tab === "history" && <MaintenanceHistory onVoid={setVoidTarget} />}
        {data && tab === "settings" && isManager && <TaskDefinitionsPanel />}
      </div>
      <VoidCompletionDialog target={voidTarget} onClose={() => setVoidTarget(null)} />
    </div>
  );
}