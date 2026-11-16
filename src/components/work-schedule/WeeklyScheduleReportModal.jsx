import { useState } from "react";
import { Copy, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import PersonalWorkerMessageTab from "@/components/work-schedule/PersonalWorkerMessageTab";
import WeeklyScheduleReportDays from "@/components/work-schedule/WeeklyScheduleReportDays";
import WeeklyScheduleReportWorkers from "@/components/work-schedule/WeeklyScheduleReportWorkers";
import { generateWeeklySchedulePdfHtml } from "@/components/work-schedule/WeeklySchedulePdfView";
import ReportPeriodSelector from "@/components/work-schedule/report/ReportPeriodSelector";
import MultiWeekWorkersReport from "@/components/work-schedule/report/MultiWeekWorkersReport";
import { generateMultiWeekTeamPdfHtml } from "@/components/work-schedule/report/MultiWeekTeamPdfView";
import useScheduleWeeks from "@/hooks/useScheduleWeeks";
import { buildMultiWeekTeamReport, periodWeekStarts, periodEnd, fmtFullDate, unpublishedListText } from "@/lib/multiWeekTeamReport";
import { generateWeeklyWhatsAppText, generateWorkersOnlyText } from "@/lib/weeklyScheduleReport";

export default function WeeklyScheduleReportModal({ open, onClose, schedule, shifts, weekStart, workers = [] }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("workers");
  const [weekCount, setWeekCount] = useState(1);
  const [startWeek, setStartWeek] = useState(weekStart);
  const isMulti = weekCount > 1;
  // One week starting at the page's week = the original report, built from the page's own data
  const isOriginal = !isMulti && startWeek === weekStart;
  const { weeks, isLoading, error } = useScheduleWeeks(periodWeekStarts(startWeek, weekCount), !isOriginal);
  const single = isOriginal ? { schedule, shifts, weekStart } : { schedule: weeks[0].schedule, shifts: weeks[0].shifts, weekStart: startWeek };
  const teamReport = isMulti && !isLoading && !error ? buildMultiWeekTeamReport(weeks) : null;
  const generalText = generateWeeklyWhatsAppText(single.schedule, single.shifts, single.weekStart);
  const workersText = generateWorkersOnlyText(single.schedule, single.shifts, single.weekStart);

  const changeWeekCount = (count) => {
    setWeekCount(count);
    if (count > 1) setTab("workers");
  };

  const copyText = async (text, message) => {
    await navigator.clipboard.writeText(text);
    toast({ description: message });
  };

  const openPrintWindow = (html) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  const handlePrint = () => {
    if (!isMulti) return openPrintWindow(generateWeeklySchedulePdfHtml(single.schedule, single.shifts, single.weekStart));
    if (!teamReport) return;
    if (teamReport.unpublished.length && !window.confirm(`השבועות הבאים טרם פורסמו ולא ייכללו במסמך:\n${unpublishedListText(teamReport)}\n\nהמסמך יסומן כחלקי. להמשיך?`)) return;
    openPrintWindow(generateMultiWeekTeamPdfHtml(teamReport));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle className="text-base">{isMulti ? `דוח לפי עובדים · ${fmtFullDate(startWeek)} – ${fmtFullDate(periodEnd(startWeek, weekCount))}` : "דוח שבועי"}</DialogTitle></DialogHeader>
        <ReportPeriodSelector weekCount={weekCount} onWeekCountChange={changeWeekCount} startWeek={startWeek} onStartWeekChange={setStartWeek} pageWeekStart={weekStart} />
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="workers">לפי עובדים</TabsTrigger>
              <TabsTrigger value="personal" disabled={isMulti}>הודעה לעובד</TabsTrigger>
              <TabsTrigger value="days" disabled={isMulti}>לפי ימים</TabsTrigger>
              <TabsTrigger value="whatsapp" disabled={isMulti}>טקסט ל-WhatsApp</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2 flex-wrap">
              {!isMulti && <Button type="button" variant="outline" size="sm" onClick={() => copyText(generalText, "הדוח הכללי הועתק")}> <Copy className="w-4 h-4" /> העתק דוח כללי</Button>}
              {!isMulti && <Button type="button" variant="outline" size="sm" onClick={() => copyText(workersText, "דוח לפי עובדים הועתק")}> <Copy className="w-4 h-4" /> העתק לפי עובדים</Button>}
              <Button type="button" variant="outline" size="sm" onClick={handlePrint} disabled={isLoading || (isMulti && !teamReport)}> <Printer className="w-4 h-4" /> הדפס / PDF</Button>
            </div>
          </div>
          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message || "שגיאה בטעינת הסידור"}</div>}
          {isLoading && <div className="mt-4 text-center py-10 text-slate-400 text-sm">טוען סידור עבודה...</div>}
          {!isLoading && !error && <>
            <TabsContent value="workers" className="mt-4">
              {isMulti
                ? teamReport && <MultiWeekWorkersReport report={teamReport} />
                : <WeeklyScheduleReportWorkers schedule={single.schedule} shifts={single.shifts} weekStart={single.weekStart} onCopyWorker={(text) => copyText(text, "ההודעה לעובד הועתקה")} />}
            </TabsContent>
            <TabsContent value="personal" className="mt-4">
              <PersonalWorkerMessageTab schedule={single.schedule} shifts={single.shifts} weekStart={single.weekStart} workers={workers} onCopy={(text) => copyText(text, "ההודעה לעובד הועתקה")} />
            </TabsContent>
            <TabsContent value="days" className="mt-4"><WeeklyScheduleReportDays schedule={single.schedule} shifts={single.shifts} weekStart={single.weekStart} /></TabsContent>
            <TabsContent value="whatsapp" className="mt-4"><Textarea readOnly value={generalText} rows={22} className="font-mono text-xs leading-5 bg-slate-50" /></TabsContent>
          </>}
        </Tabs>
        <div className="flex justify-end pt-2"><Button type="button" variant="ghost" onClick={onClose}>סגור</Button></div>
      </DialogContent>
    </Dialog>
  );
}