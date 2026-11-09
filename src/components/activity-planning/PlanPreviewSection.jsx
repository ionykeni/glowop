import { Button } from "@/components/ui/button";
import { Loader2, SearchCheck } from "lucide-react";
import PreviewStationCard from "./PreviewStationCard";
import PlanStatusBadge from "./PlanStatusBadge";

function groupByTime(stations) {
  const slots = new Map();
  [...stations].sort((a, b) => (a.start_time || "99").localeCompare(b.start_time || "99") || String(a.space_name).localeCompare(String(b.space_name), "he"))
    .forEach(s => { const k = s.start_time || "—"; slots.set(k, [...(slots.get(k) || []), s]); });
  return [...slots.entries()];
}

export default function PlanPreviewSection({ plan }) {
  const { preview, previewStale, previewing, previewError, runPreview, canPreview } = plan;
  const counts = preview ? preview.stations.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {}) : {};
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <h2 className="text-sm font-bold text-slate-500 flex-1">ד. בדיקה ותצוגה מקדימה</h2>
        <Button onClick={runPreview} disabled={!canPreview || previewing} className="gap-1.5">
          {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchCheck className="w-4 h-4" />} בדוק זמינות והצג תצוגה מקדימה
        </Button>
      </div>
      {!canPreview && <p className="text-xs text-slate-500">יש לבחור תאריך ולהשאיר לפחות תחנה אחת.</p>}
      {previewError && <p className="text-sm text-red-600">{previewError}</p>}
      {previewStale && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">התוכנית שונתה מאז הבדיקה האחרונה — יש לבדוק שוב.</p>}
      {preview?.template_changed && <p className="text-xs text-red-700">גרסת התבנית השתנתה מאז שנפתחה — יש לרענן את הדף.</p>}
      {preview && (
        <div className={`space-y-4 ${previewStale ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>נבדק {new Date(preview.checked_at).toLocaleTimeString("he-IL")} · גרסה {preview.template.version}</span>
            {Object.entries(counts).map(([status, n]) => <span key={status} className="flex items-center gap-1"><PlanStatusBadge status={status} />{n}</span>)}
          </div>
          {groupByTime(preview.stations).map(([time, list]) => (
            <div key={time} className="space-y-2">
              <p className="text-xs font-bold text-primary">{time}</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">{list.map(s => <PreviewStationCard key={s.station_id} station={s} />)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}