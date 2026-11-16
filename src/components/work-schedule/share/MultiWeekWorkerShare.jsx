import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { errorText } from "@/lib/scheduleReportClient";
import { periodRange, missingWeekLabels, multiWeekMessage } from "@/lib/multiWeekShare";
import WorkerPdfShareActions from "@/components/work-schedule/share/WorkerPdfShareActions";

// Reuses the manager-only report endpoint to list workers and week statuses for the period.
export default function MultiWeekWorkerShare({ period, workers = [], onCopy }) {
  const { range } = periodRange(period);
  const { data: report, isLoading, error } = useQuery({
    queryKey: ["multiWeekShareReport", range?.start, range?.end],
    enabled: !!range,
    queryFn: async () => (await base44.functions.invoke("getWorkScheduleReport", { action: "report", start: range.start, end: range.end })).data.report,
  });
  const people = useMemo(() => (report?.workers || []).map((w) => ({ id: w.worker_id, name: w.worker_name, published: w.published.shift_count + w.published.on_call_count })), [report]);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => { if (!people.some((p) => p.id === selectedId)) setSelectedId(people[0]?.id || ""); }, [people, selectedId]);

  if (!range) return null;
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  if (error) return <div className="text-sm text-destructive">{errorText(error, "טעינת הסידור לתקופה נכשלה")}</div>;

  const missing = missingWeekLabels(report, range);
  const person = people.find((p) => p.id === selectedId) || null;
  const phone = workers.find((w) => w.id === selectedId)?.phone || "";
  const message = person ? multiWeekMessage(person.name, range, missing) : "";

  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm space-y-1">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> התקופה אינה מלאה – שבועות שטרם פורסמו לא ייכללו ב-PDF:</div>
          {missing.map((m) => <div key={m} dir="ltr" className="text-right">{m}</div>)}
        </div>
      )}
      {people.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-sm text-slate-500">אין עובדים עם משמרות בתקופה זו</div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <label className="block text-sm font-semibold text-slate-700">בחר עובד</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.published} משמרות שפורסמו{workers.find((w) => w.id === p.id)?.phone ? ` · ${workers.find((w) => w.id === p.id).phone}` : ""}</option>)}
            </select>
            {person && person.published === 0 && <div className="text-xs text-amber-700">לעובד זה אין משמרות שפורסמו בתקופה – ה-PDF יציין זאת.</div>}
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-700">הודעה ו-PDF מאוחד לעובד</h3>
            <pre className="whitespace-pre-wrap text-sm leading-7 font-sans bg-white border border-slate-200 rounded-xl p-4 text-slate-800">{message}</pre>
            {person && <WorkerPdfShareActions key={`${person.id}-${range.start}-${range.end}`} workerId={person.id} phone={phone} range={range} message={message} onCopy={onCopy} />}
          </div>
        </>
      )}
    </div>
  );
}