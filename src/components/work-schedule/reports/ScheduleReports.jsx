import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";
import { presetRange, errorText } from "@/lib/scheduleReportClient";
import ReportRangeControls from "@/components/work-schedule/reports/ReportRangeControls";
import ReportSummaryCards from "@/components/work-schedule/reports/ReportSummaryCards";
import ReportWarnings from "@/components/work-schedule/reports/ReportWarnings";
import ReportWorkerTable from "@/components/work-schedule/reports/ReportWorkerTable";
import ReportPdfActions from "@/components/work-schedule/reports/ReportPdfActions";

export default function ScheduleReports() {
  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [workerId, setWorkerId] = useState("ALL");
  const validRange = range.start && range.end && range.start <= range.end;
  const { data: report, isLoading, error } = useQuery({
    queryKey: ["workScheduleReport", range.start, range.end],
    enabled: !!validRange,
    queryFn: async () => (await base44.functions.invoke("getWorkScheduleReport", { action: "report", ...range })).data.report,
  });
  const selected = useMemo(() => (report && workerId !== "ALL" ? report.workers.filter((w) => w.worker_id === workerId) : report?.workers || []), [report, workerId]);
  const totals = workerId === "ALL" || !selected[0] ? report?.team : selected[0];
  const warnings = useMemo(() => (report?.warnings || []).filter((w) => workerId === "ALL" || !w.worker_id || w.worker_id === workerId), [report, workerId]);

  return <div className="space-y-4">
    <div><h2 className="text-lg font-bold">דוחות סידור עבודה</h2><p className="text-xs text-slate-500">שעות מתוכננות לפי סידור העבודה בלבד – אינן שעות עבודה בפועל ואינן בסיס לשכר. שעון ישראל.</p></div>
    <ReportRangeControls preset={preset} setPreset={setPreset} range={range} setRange={setRange} workers={report?.workers || []} workerId={workerId} setWorkerId={setWorkerId} />
    {!validRange ? <div className="text-sm text-destructive">תאריך הסיום מוקדם מתאריך ההתחלה</div>
      : isLoading ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      : error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{errorText(error, "לא ניתן לטעון את הדוח")}</div>
      : report && <>
        <ReportPdfActions range={range} workerId={workerId} />
        <ReportSummaryCards totals={totals || report.team} workerCount={workerId === "ALL" ? report.workers.length : null} />
        <ReportWarnings report={report} warnings={warnings} />
        <ReportWorkerTable workers={selected} team={report.team} showTeamRow={workerId === "ALL" && selected.length > 1} />
      </>}
  </div>;
}