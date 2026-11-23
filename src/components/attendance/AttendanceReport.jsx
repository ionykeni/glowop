import { useState } from "react";
import { FileDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import PeriodNav from "./PeriodNav";
import { REPORT_NOTE, WORKER_HEADERS } from "./attendanceReportPresentation";
import { printManagementAttendance } from "./managementAttendancePdf";
import { useToast } from "@/components/ui/use-toast";
import ReportWorkerRow from "./ReportWorkerRow";
import { WorkerSelect } from "./ManagerFilters";
import { useAttendanceReport } from "@/hooks/useAttendance";
import { israelToday, addDays, weekStartOf, monthOf, shiftMonth, monthTitle, fmtDay, fmtTime } from "@/lib/attendanceFormat";

const startFor = (period) => (period === "week" ? weekStartOf(israelToday()) : `${monthOf(israelToday())}-01`);

export default function AttendanceReport() {
  const [period, setPeriod] = useState("month");
  const [start, setStart] = useState(() => startFor("month"));
  const [workerId, setWorkerId] = useState("");
  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useAttendanceReport({ period, start, worker_id: workerId || undefined });
  const { toast } = useToast();
  const choose = (p) => { setPeriod(p); setStart(startFor(p)); };
  const move = (n) => setStart(period === "week" ? addDays(start, 7 * n) : `${shiftMonth(monthOf(start), n)}-01`);
  const label = period === "week" ? `שבוע ${fmtDay(start)} – ${fmtDay(addDays(start, 6))}` : monthTitle(monthOf(start));
  const filterOptions = new Map((data?.workers_list || []).map((w) => [w.id, w]));
  for (const w of data?.workers || []) {
    if (!filterOptions.has(w.worker_id)) filterOptions.set(w.worker_id, { id: w.worker_id, full_name: w.worker_name });
  }
  if (workerId && !filterOptions.has(workerId)) filterOptions.set(workerId, { id: workerId, full_name: "העובד שנבחר" });

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-muted rounded-xl p-1">
        {[["week", "שבועי"], ["month", "חודשי"]].map(([id, text]) => (
          <button key={id} onClick={() => choose(id)} className={`flex-1 h-9 rounded-lg text-sm font-semibold ${period === id ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>{text}</button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <PeriodNav label={label} onPrev={() => move(-1)} onNext={() => move(1)} nextDisabled={start >= startFor(period)} />
        <div className="flex items-center"><WorkerSelect value={workerId} onChange={setWorkerId} workers={[...filterOptions.values()]} allLabel="כל העובדים" ariaLabel="סינון לפי עובד" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "animate-spin" : ""} />רענון
        </Button>
        {period === "month" && <Button size="sm" variant="outline" disabled={!data?.workers.length || data.limited || isFetching || isPlaceholderData || !!error}
          onClick={() => { if (!printManagementAttendance(data, label)) toast({ title: "יש לאפשר חלונות קופצים כדי לפתוח את הדוח", variant: "destructive" }); }}>
          <FileDown />{workerId ? "PDF ניהולי לעובד" : "PDF ניהולי לכל העובדים"}
        </Button>}
        {data?.generated_at && !isPlaceholderData && <span className="text-xs text-muted-foreground">עודכן ב־{fmtTime(data.generated_at)}</span>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      {isLoading || isPlaceholderData ? (
        <div role="status" aria-label="טוען דוח נוכחות" className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : data && (
        <div className="space-y-2">
          {data.workers.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">אין נתוני נוכחות או משמרות לתקופה זו.</p> : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full table-fixed text-xs sm:text-sm" aria-label="סיכום נוכחות לפי עובד">
                <thead className="bg-muted/40 text-muted-foreground"><tr>{WORKER_HEADERS.map((h, i) => <th key={h} scope="col" className={i === 0 ? "w-[28%] px-2 py-3 text-start font-medium sm:px-4" : "px-1 py-3 text-center font-medium sm:px-4"}>{h}</th>)}</tr></thead>
                <tbody>{data.workers.map((w) => <ReportWorkerRow key={`${start}-${w.worker_id}`} worker={w} generatedAt={data.generated_at} />)}</tbody>
              </table>
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">{REPORT_NOTE}</p>
          {data.limited && <p className="text-xs text-amber-700">הדוח חלקי. כדי לייצא, יש לצמצם את התצוגה לעובד אחד.</p>}
        </div>
      )}
    </div>
  );
}