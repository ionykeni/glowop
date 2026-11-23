import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import ComparisonChips from "./ComparisonChips";
import PeriodNav from "./PeriodNav";
import TotalsChips from "./TotalsChips";
import ReportWorkerRow from "./ReportWorkerRow";
import { WorkerSelect } from "./ManagerFilters";
import { useAttendanceReport } from "@/hooks/useAttendance";
import { israelToday, addDays, weekStartOf, monthOf, shiftMonth, monthTitle, fmtDay, fmtTime } from "@/lib/attendanceFormat";

const startFor = (period) => (period === "week" ? weekStartOf(israelToday()) : `${monthOf(israelToday())}-01`);

export default function AttendanceReport() {
  const [period, setPeriod] = useState("month");
  const [start, setStart] = useState(() => startFor("month"));
  const [workerId, setWorkerId] = useState("");
  const { data, isLoading, isFetching, error, refetch } = useAttendanceReport({ period, start, worker_id: workerId || undefined });
  const choose = (p) => { setPeriod(p); setStart(startFor(p)); };
  const move = (n) => setStart(period === "week" ? addDays(start, 7 * n) : `${shiftMonth(monthOf(start), n)}-01`);
  const label = period === "week" ? `שבוע ${fmtDay(start)} – ${fmtDay(addDays(start, 6))}` : monthTitle(monthOf(start));

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-muted rounded-xl p-1">
        {[["week", "שבועי"], ["month", "חודשי"]].map(([id, text]) => (
          <button key={id} onClick={() => choose(id)} className={`flex-1 h-9 rounded-lg text-sm font-semibold ${period === id ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>{text}</button>
        ))}
      </div>
      <PeriodNav label={label} onPrev={() => move(-1)} onNext={() => move(1)} nextDisabled={start >= startFor(period)} />
      <WorkerSelect value={workerId} onChange={setWorkerId} workers={data?.workers_list} allLabel="כל העובדים" />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : data && (
        <div className={`space-y-3 ${isFetching ? "opacity-60" : ""}`}>
          <TotalsChips totals={data.team} />
          <ComparisonChips comparison={data.team.comparison} verifiedMinutes={data.team.verified_minutes} />
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {data.disclaimer} ההשוואה מחושבת מחדש בכל טעינה לפי הסידור המפורסם כפי שהוא כעת, ולכן עשויה להשתנות אם משמרות עבר ייערכו. משמרת ללא רישום שעון מסומנת לבדיקה ואינה היעדרות.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="shrink-0">
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
              רענון{data.generated_at ? ` · ${fmtTime(data.generated_at)}` : ""}
            </Button>
          </div>
          {data.workers.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">אין נוכחות בתקופה זו</p>
          ) : (
            <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
              {data.workers.map((w) => <ReportWorkerRow key={w.worker_id} worker={w} />)}
            </div>
          )}
          {data.limited && <p className="text-xs text-center text-amber-700">מוצגות 1,000 הרשומות הראשונות — צמצמו לפי עובד</p>}
        </div>
      )}
    </div>
  );
}