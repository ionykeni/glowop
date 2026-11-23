import { useState } from "react";
import { Loader2 } from "lucide-react";
import ManagerFilters from "./ManagerFilters";
import ManagerSection from "./ManagerSection";
import MissingAttendanceList from "./MissingAttendanceList";
import ManagerAddRecord from "./ManagerAddRecord";
import TotalsChips from "./TotalsChips";
import { useManagerDay } from "@/hooks/useAttendance";
import { israelToday, fmtMinutes } from "@/lib/attendanceFormat";

export default function ManagerDayView() {
  const [date, setDate] = useState(israelToday());
  const [workerId, setWorkerId] = useState("");
  const { data, isLoading, isFetching, error } = useManagerDay({ date, worker_id: workerId || undefined });
  const s = data?.sections;
  const empty = s && !Object.values(s).some((x) => x.length) && !data.missing.length;

  return (
    <div className="space-y-3">
      <ManagerFilters date={date} onDate={setDate} workerId={workerId} onWorker={setWorkerId} workers={data?.workers} />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : data && (
        <div className={`space-y-3 ${isFetching ? "opacity-60" : ""}`}>
          <TotalsChips totals={data.team} />
          <ManagerAddRecord workers={data.workers} />
          <ManagerSection title="בעבודה כעת" records={s.active} tone="text-primary" />
          <ManagerSection title="נסגרו אוטומטית — דורש בדיקה" records={s.needs_review} tone="text-red-700" />
          <MissingAttendanceList items={data.missing} />
          <ManagerSection title="תוקנו ידנית" records={s.corrected} tone="text-amber-700" />
          <ManagerSection title="סיימו עבודה" records={s.finished} />
          <ManagerSection title="בוטלו" records={s.voided} tone="text-muted-foreground" />
          {empty && <p className="text-center text-sm text-muted-foreground py-8">אין נוכחות ביום זה</p>}
          {data.totals.length > 0 && (
            <div className="rounded-2xl border border-border bg-card divide-y divide-border">
              <p className="px-4 py-2 text-sm font-bold bg-muted/40">שעות לפי עובד ביום זה</p>
              {data.totals.map((w) => (
                <div key={w.worker_id} className="px-4 py-2 text-sm flex justify-between gap-2">
                  <span className="font-semibold">{w.worker_name}</span>
                  <span className="tabular-nums">{fmtMinutes(w.verified_minutes + w.active_minutes)}{w.unverified_minutes > 0 && <span className="text-red-600"> · {fmtMinutes(w.unverified_minutes)} לא מאושר</span>}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}