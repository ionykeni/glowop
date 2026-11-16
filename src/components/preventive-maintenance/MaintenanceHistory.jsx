import { useState } from "react";
import { Loader2, History } from "lucide-react";
import HistoryFilters from "./HistoryFilters";
import HistoryRow from "./HistoryRow";
import { usePmHistory } from "@/hooks/usePreventiveMaintenance";

const EMPTY = { task_id: "", unit_key: "", worker_user_id: "", status: "", from: "", to: "" };

export default function MaintenanceHistory({ onVoid }) {
  const [filters, setFilters] = useState(EMPTY);
  const { data, isLoading, isFetching, error } = usePmHistory(filters);
  const events = data?.events || [];

  return (
    <div className="space-y-3">
      <HistoryFilters filters={filters} onChange={setFilters} options={data?.options} onReset={() => setFilters(EMPTY)} />
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <History className="w-7 h-7 mx-auto mb-2 opacity-30" />
          אין רשומות תחזוקה להצגה
        </div>
      ) : (
        <div className={`rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden ${isFetching ? "opacity-60" : ""}`}>
          {events.map((ev) => (
            <HistoryRow key={ev.id} ev={ev} onVoid={() => onVoid({ event_id: ev.id, title: `${ev.title}${ev.unit_label ? ` — ${ev.unit_label}` : ""}` })} />
          ))}
        </div>
      )}
      {data?.limited && <p className="text-xs text-center text-muted-foreground">מוצגות 300 הרשומות האחרונות — צמצמו את הסינון לצפייה ברשומות קודמות</p>}
    </div>
  );
}