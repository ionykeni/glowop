import { fmtMinutes } from "@/lib/scheduleReportClient";

const Card = ({ label, value, hint, tone = "text-slate-900" }) => <div className="rounded-xl border bg-white px-4 py-3">
  <div className="text-xs text-slate-500">{label}</div>
  <div className={`text-2xl font-bold tabular-nums mt-0.5 ${tone}`}>{value}</div>
  {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
</div>;

export default function ReportSummaryCards({ totals, workerCount }) {
  const { published, draft } = totals;
  return <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
    <Card label="שעות מתוכננות שפורסמו" value={fmtMinutes(published.planned_minutes)} hint="לפי הסידור, לא שעות בפועל" tone="text-primary" />
    <Card label="שעות בטיוטה (לא פורסם)" value={fmtMinutes(draft.planned_minutes)} hint={draft.shift_count ? `${draft.shift_count} משמרות` : "אין"} tone={draft.planned_minutes ? "text-amber-600" : "text-slate-400"} />
    <Card label="משמרות שפורסמו" value={published.shift_count} hint={workerCount != null ? `${workerCount} עובדים` : null} />
    <Card label="כונן לילה" value={published.on_call_count} hint="לא נכלל בשעות" tone="text-cyan-700" />
    <Card label="חפיפות בין משמרות" value={fmtMinutes(published.overlap_minutes)} hint="נספרו פעם אחת" tone={published.overlap_minutes ? "text-orange-600" : "text-slate-400"} />
  </div>;
}