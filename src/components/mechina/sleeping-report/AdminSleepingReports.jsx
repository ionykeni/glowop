import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, AlertTriangle } from "lucide-react";
import { formatDateTime, formatPeriod } from "@/lib/mechinaSleepingReportCalc";
import AdminReportDetail from "./AdminReportDetail";

export default function AdminSleepingReports() {
  const [reports, setReports] = useState(null);
  const [selected, setSelected] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async (next) => {
    setBusy(true);
    try {
      const r = await base44.functions.invoke("mechinaSleepingReport", { action: "admin_list", cursor: next || undefined });
      if (!r.data?.success) throw new Error(r.data?.error || "שגיאה בטעינת דיווחים");
      setReports(old => next ? [...old, ...r.data.reports] : r.data.reports);
      setCursor(r.data.has_more ? r.data.next_cursor : null);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <p role="alert" className="text-destructive">{error}</p>;
  if (!reports) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (selected) return <AdminReportDetail report={selected} onClose={() => setSelected(null)} />;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">דיווחים מידעיים בלבד — אינם משנים שיבוצים. גרסה נוכחית לכל מכינה ותקופה.</p>
      {reports.length === 0 && <p className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-xl">עדיין לא הוגשו דיווחים</p>}
      {reports.map(r => (
        <button key={r.id} onClick={() => setSelected(r)} className="w-full text-right bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-muted transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{r.group_name}</p>
            <p className="text-xs text-muted-foreground">{formatPeriod({ start: r.period_start, end: r.period_end })} · גרסה {r.version_number} · {formatDateTime(r.submitted_at)}</p>
          </div>
          <div className="text-left text-xs">
            <p className="font-bold text-foreground">{r.total_students}/{r.expected_students}</p>
            <p className={r.difference === 0 ? "text-emerald-600" : "text-orange-600"}>{r.difference > 0 ? "+" : ""}{r.difference}</p>
          </div>
          {r.warnings_count > 0 && <span className="flex items-center gap-0.5 text-xs text-orange-600"><AlertTriangle className="w-3.5 h-3.5" />{r.warnings_count}</span>}
        </button>
      ))}
      {cursor && <button disabled={busy} onClick={() => load(cursor)} className="text-primary underline">{busy ? "טוען..." : "טען דיווחים נוספים"}</button>}
    </div>
  );
}