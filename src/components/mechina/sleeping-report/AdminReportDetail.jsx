import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, X } from "lucide-react";
import { formatDateTime, formatPeriod } from "@/lib/mechinaSleepingReportCalc";
import VersionHistoryList from "@/components/mechina/sleeping-report/VersionHistoryList";
import ReportVersionContent from "@/components/mechina/sleeping-report/ReportVersionContent";
import ReportVersionComparison from "@/components/mechina/sleeping-report/ReportVersionComparison";
export default function AdminReportDetail({ report, onClose }) {
  const [versions, setVersions] = useState([]), [detail, setDetail] = useState(null), [error, setError] = useState("");
  const [cursor, setCursor] = useState(null);
  const loadVersion = async id => {
    setDetail(null); setError("");
    try {
      const r = await base44.functions.invoke("mechinaSleepingReport", { action: "version_detail", version_id: id });
      if (!r.data?.success) throw new Error(r.data?.error || "שגיאה");
      setDetail(r.data.version);
    } catch (e) { setError(e.message); }
  };
  const loadHistory = async next => {
    const r = await base44.functions.invoke("mechinaSleepingReport", { action: next ? "history" : "context", group_id: report.group_id, period_key: report.period_key, cursor: next || undefined });
    if (!r.data?.success) { setError(r.data?.error || "שגיאה"); return; }
    setVersions(old => next ? [...old, ...r.data.versions] : r.data.versions);
    setCursor(r.data.has_more ? r.data.next_cursor : null);
  };
  useEffect(() => { loadHistory(); loadVersion(report.id); }, [report.id]);
  return <div className="rounded-xl border border-border bg-card p-4 space-y-4">
    <div className="flex justify-between items-start gap-3">
      <div><h2 className="font-heading text-lg">{report.group_name}</h2><p className="text-sm text-muted-foreground">{formatPeriod({ start: report.period_start, end: report.period_end })}</p></div>
      <button onClick={onClose} aria-label="חזור לרשימת הדיווחים"><X className="w-5 h-5" /></button>
    </div>
    {error ? <p role="alert" className="text-destructive">{error}</p> : !detail ? <Loader2 className="animate-spin mx-auto" /> : <>
      <p className="text-sm font-semibold">גרסה {detail.version_number} · {formatDateTime(detail.submitted_at)} · {detail.submitted_by_name}</p>
      <ReportVersionComparison comparison={detail.comparison} />
      <ReportVersionContent version={detail} />
    </>}
    <VersionHistoryList versions={versions} onSelect={v => loadVersion(v.id)} onLoadMore={cursor ? () => loadHistory(cursor) : undefined} />
  </div>;
}