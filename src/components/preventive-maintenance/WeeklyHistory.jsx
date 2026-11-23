import { useState } from "react";
import { History, Loader2 } from "lucide-react";
import WeeklyHistoryRow from "./WeeklyHistoryRow";
import { usePmWeeklyHistory } from "@/hooks/usePreventiveMaintenance";

const field = "h-10 w-full rounded-lg border border-input bg-card px-2 text-sm";

export default function WeeklyHistory() {
  const [filters, setFilters] = useState({ task_id: "", result: "" });
  const { data, isLoading, isFetching, error } = usePmWeeklyHistory(filters);
  const weeks = data?.weeks || [];
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-3 grid grid-cols-2 gap-2">
        <select className={field} value={filters.task_id} onChange={(e) => set("task_id", e.target.value)}>
          <option value="">כל המשימות השבועיות</option>
          {(data?.tasks || []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <select className={field} value={filters.result} onChange={(e) => set("result", e.target.value)}>
          <option value="">כל השבועות</option>
          <option value="COMPLETED">בוצע</option>
          <option value="MISSED">לא בוצע</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : weeks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <History className="w-7 h-7 mx-auto mb-2 opacity-30" />
          אין שבועות קודמים להצגה
        </div>
      ) : (
        <div className={`rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden ${isFetching ? "opacity-60" : ""}`}>
          {weeks.map((w) => <WeeklyHistoryRow key={w.id} week={w} />)}
        </div>
      )}
      {data?.limited && <p className="text-xs text-center text-muted-foreground">מוצגים 300 השבועות האחרונים — צמצמו את הסינון</p>}
    </div>
  );
}