import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, X, AlertTriangle } from "lucide-react";
import { WARNING_LABELS, formatDateTime, formatPeriod } from "@/lib/mechinaSleepingReportCalc";
import VersionHistoryList from "./VersionHistoryList";

// Admin read-only view: reported occupancy vs official allocation, plus all versions.
export default function AdminReportDetail({ report, onClose }) {
  const [versions, setVersions] = useState([]);
  const [detail, setDetail] = useState(null);

  const loadVersion = async (id) => {
    setDetail(null);
    const r = await base44.functions.invoke("mechinaSleepingReport", { action: "version_detail", version_id: id });
    setDetail(r.data?.version || null);
  };

  useEffect(() => {
    base44.functions.invoke("mechinaSleepingReport", { action: "context", group_id: report.group_id, period_key: report.period_key })
      .then(r => setVersions(r.data?.versions || []));
    loadVersion(report.id);
  }, [report.id]);

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-foreground">{report.group_name}</p>
          <p className="text-xs text-muted-foreground">{formatPeriod({ start: report.period_start, end: report.period_end })}</p>
        </div>
        <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
      </div>
      {!detail ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /> : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">גרסה {detail.version_number} · {formatDateTime(detail.submitted_at)} · {detail.submitted_by_name}</p>
          {detail.comparison && (
            <p className="text-xs text-orange-700">תיקון לגרסה {detail.comparison.prev_version_number}: {detail.comparison.prev_total} → {detail.comparison.total} ({detail.comparison.changed_tents.length} אוהלים שונו)</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b border-border">
                <th className="text-right py-1">שכונה</th><th className="text-right">אוהל</th><th>רשמי</th><th>בנים</th><th>בנות</th><th>בפועל</th><th>קיבולת</th><th className="text-right">חריגות</th>
              </tr></thead>
              <tbody>
                {detail.snapshot.entries.map(e => {
                  const off = e.total !== e.official_pax;
                  return (
                    <tr key={e.tent_id} className={`border-b border-border ${off || e.warnings.length ? "bg-orange-50" : ""}`}>
                      <td className="py-1">{e.neighborhood_name}</td><td className="font-semibold">{e.tent_code}</td>
                      <td className="text-center">{e.official_pax}</td><td className="text-center">{e.boys}</td><td className="text-center">{e.girls}</td>
                      <td className={`text-center font-bold ${off ? "text-orange-700" : ""}`}>{e.total}</td><td className="text-center">{e.capacity}</td>
                      <td>{e.warnings.map(w => <span key={w} className="inline-flex items-center gap-0.5 ml-1"><AlertTriangle className="w-3 h-3 text-orange-500" />{WARNING_LABELS[w]}</span>)}{e.note && <span className="block text-muted-foreground">{e.note}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {detail.snapshot.general_notes && <p className="text-xs bg-muted rounded px-2 py-1">{detail.snapshot.general_notes}</p>}
        </div>
      )}
      <VersionHistoryList versions={versions} onSelect={v => loadVersion(v.id)} />
    </div>
  );
}