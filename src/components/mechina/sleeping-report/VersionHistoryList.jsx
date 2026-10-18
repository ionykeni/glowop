import { useState } from "react";
import { FileDown, RefreshCw, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { openVersionPdf } from "@/lib/mechinaSleepingReportPdf";
import { formatDateTime } from "@/lib/mechinaSleepingReportCalc";

export default function VersionHistoryList({ versions, onRetryPdf, onSelect, onLoadMore }) {
  const [busy, setBusy] = useState("");
  if (!versions.length) return null;
  const open = async (id) => {
    setBusy(id);
    try { await openVersionPdf(id); } catch (e) { toast.error(e.message); }
    setBusy("");
  };
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2"><History className="w-4 h-4 text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">היסטוריית גרסאות</h3></div>
      {versions.map(v => (
        <div key={v.id} className="bg-card border border-border rounded-xl px-3 py-2.5 flex items-center gap-3 flex-wrap">
          <button className="flex-1 min-w-0 text-right" onClick={() => onSelect?.(v)} disabled={!onSelect}>
            <p className="text-sm font-semibold text-foreground">
              גרסה {v.version_number} — {v.total_students} חניכים
              {v.is_current && <span className="mr-2 text-[10px] bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">נוכחית</span>}
              {v.status === "PENDING_PDF" && <span className="mr-2 text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">ההגשה לא הושלמה</span>}
            </p>
            <p className="text-xs text-muted-foreground">{formatDateTime(v.submitted_at)} · {v.submitted_by_name || v.submitted_by_email}</p>
          </button>
          {v.has_pdf ? (
            <Button size="sm" variant="outline" className="gap-1" disabled={busy === v.id} onClick={() => open(v.id)}>
              <FileDown className="w-3.5 h-3.5" /> PDF
            </Button>
          ) : onRetryPdf && (
            <Button size="sm" variant="outline" className="gap-1 border-amber-300 text-amber-700" onClick={() => onRetryPdf(v)}>
              <RefreshCw className="w-3.5 h-3.5" /> השלם הגשה
            </Button>
          )}
        </div>
      ))}
      {onLoadMore && <Button variant="outline" size="sm" onClick={onLoadMore}>טען גרסאות קודמות</Button>}
    </section>
  );
}