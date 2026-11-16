import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateWorkerPersonalMessage, groupShiftsByWorker } from "@/lib/weeklyScheduleReport";
import { addDays } from "@/lib/scheduleReportClient";
import SharePeriodSelector from "@/components/work-schedule/share/SharePeriodSelector";
import MultiWeekWorkerShare from "@/components/work-schedule/share/MultiWeekWorkerShare";

export default function PersonalWorkerMessageTab({ schedule, shifts, weekStart, workers = [], onCopy }) {
  const reportWorkers = useMemo(() => groupShiftsByWorker(schedule, shifts), [schedule, shifts]);
  const [selectedKey, setSelectedKey] = useState(reportWorkers[0]?.key || "");

  useEffect(() => {
    if (!reportWorkers.some((worker) => worker.key === selectedKey)) setSelectedKey(reportWorkers[0]?.key || "");
  }, [reportWorkers, selectedKey]);

  const selectedWorker = reportWorkers.find((worker) => worker.key === selectedKey) || null;
  const workerProfile = selectedWorker ? workers.find((worker) => worker.id === selectedWorker.key || worker.full_name === selectedWorker.name) : null;
  const message = selectedWorker ? generateWorkerPersonalMessage(selectedWorker, schedule, weekStart) : "";
  // "1" keeps the original one-week text flow below exactly as it was; 2+ weeks / custom use the consolidated PDF flow.
  const [period, setPeriod] = useState({ mode: "1", startWeek: weekStart, customStart: weekStart, customEnd: addDays(weekStart, 13) });
  const selector = <SharePeriodSelector value={period} onChange={setPeriod} />;

  if (period.mode !== "1") {
    return <div className="space-y-4" dir="rtl">{selector}<MultiWeekWorkerShare period={period} workers={workers} onCopy={onCopy} /></div>;
  }

  if (reportWorkers.length === 0) {
    return <div className="space-y-4" dir="rtl">{selector}<div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-sm text-slate-500">אין עובדים עם משמרות אישיות בשבוע זה</div></div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      {selector}
      {schedule?.status !== "PUBLISHED" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2 text-sm">שים לב: הסידור עדיין טיוטה</div>
      )}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <label className="block text-sm font-semibold text-slate-700">בחר עובד</label>
        <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
          {reportWorkers.map((worker) => {
            const profile = workers.find((w) => w.id === worker.key || w.full_name === worker.name);
            return <option key={worker.key} value={worker.key}>{worker.name}{profile?.phone ? ` · ${profile.phone}` : ""}</option>;
          })}
        </select>
        {workerProfile?.phone && <div className="text-xs text-slate-500">טלפון: {workerProfile.phone}</div>}
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-bold text-slate-700">תצוגה מקדימה</h3>
          <Button type="button" size="sm" onClick={() => onCopy(message)} disabled={!message}>
            <Copy className="w-4 h-4" />
            העתק הודעה לעובד
          </Button>
        </div>
        <pre className="whitespace-pre-wrap text-sm leading-7 font-sans bg-white border border-slate-200 rounded-xl p-4 text-slate-800">{message}</pre>
      </div>
    </div>
  );
}