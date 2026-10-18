import { useState } from "react";
import { Loader2 } from "lucide-react";
import useSleepingReport from "@/hooks/useSleepingReport";
import ReportSummaryBar from "@/components/mechina/sleeping-report/ReportSummaryBar";
import NeighborhoodTentPicker from "@/components/mechina/sleeping-report/NeighborhoodTentPicker";
import TentEntryEditor from "@/components/mechina/sleeping-report/TentEntryEditor";
import VersionHistoryList from "@/components/mechina/sleeping-report/VersionHistoryList";
import ReportPeriodHeader from "@/components/mechina/sleeping-report/ReportPeriodHeader";
import ReportActions from "@/components/mechina/sleeping-report/ReportActions";
import { normalizeEntry } from "@/lib/mechinaSleepingReportCalc";

export default function SleepingReportTab({ groupId }) {
  const r = useSleepingReport(groupId);
  const [expandedScope, setExpandedScope] = useState(false);
  if (r.error) return <p role="alert" className="text-destructive">{r.error}</p>;
  if (!r.ctx || r.busy === "load") return <Loader2 className="w-6 h-6 animate-spin mx-auto my-12 text-primary" />;
  const ctx = r.ctx, sel = ctx.tents.find(t => t.id === r.selected);
  const tents = expandedScope ? ctx.tents : ctx.tents.filter(t => r.visibleIds.has(t.id));
  const reported = tents.filter(t => r.entries[t.id]?.reported).length;
  return <div className="space-y-5">
    <ReportPeriodHeader ctx={ctx} onPeriodChange={key => { setExpandedScope(false); r.load(key); }} />
    <ReportSummaryBar expected={ctx.expected_students} totals={r.totals} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">{expandedScope ? "כל האוהלים הרגילים בכל השכונות · לחצו על אוהל נוסף רק אם ישנו בו בפועל · אין צורך למלא את כולם" : <>לחצו על אוהל כדי לדווח · דווחו {reported} מתוך {tents.length} · טרם דווחו {tents.length - reported}</>}</p>
      {(expandedScope || ctx.tents.some(t => !r.visibleIds.has(t.id))) && <button type="button" aria-expanded={expandedScope} className="text-primary underline" onClick={() => setExpandedScope(v => !v)}>{expandedScope ? "הצג אוהלי קבוצה ודיווחים קיימים בלבד" : "הצג אוהלים נוספים בתחום הדיווח"}</button>}
    </div>
    {!tents.length ? <p className="text-muted-foreground">{ctx.tents.length ? "אין אוהלים משובצים לקבוצה בתקופה זו. לדיווח על לינה בפועל, פתחו את רשימת האוהלים הנוספים." : "אין אוהלים בתחום הדיווח."}</p> : <NeighborhoodTentPicker neighborhoods={ctx.neighborhoods} tents={tents} entries={r.entries} assignedSet={r.assignedSet} selectedTentId={r.selected} onSelect={r.setSelected} />}
    {sel && <TentEntryEditor tent={sel} neighborhood={ctx.neighborhoods.find(n => n.id === sel.neighborhood_id)?.name} entry={normalizeEntry(r.entries[sel.id])} assigned={r.assignedSet.has(sel.id)} onChange={r.update} onClose={() => r.setSelected("")} />}
    <label className="block text-sm space-y-1"><span>הערות כלליות (אופציונלי)</span><textarea value={r.notes} maxLength={2000} onChange={e => r.setNotes(e.target.value)} rows={2} className="block w-full rounded-lg border border-border bg-card p-3" /></label>
    <ReportActions report={r} />
    <VersionHistoryList versions={ctx.versions} onRetryPdf={r.retryPdf} onLoadMore={ctx.has_more && !r.busy ? r.loadHistory : undefined} />
  </div>;
}