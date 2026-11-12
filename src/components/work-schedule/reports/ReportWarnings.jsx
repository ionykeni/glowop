import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { fmtDate } from "@/lib/scheduleReportClient";

const STATUS = { DRAFT: "טיוטה – לא פורסם", MISSING: "אין סידור", ARCHIVED: "בארכיון" };

export default function ReportWarnings({ report, warnings }) {
  const [open, setOpen] = useState(false);
  const ex = report.excluded;
  return <div className="space-y-2">
    {report.unpublished_weeks.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> שבועות שלא פורסמו בטווח</div>
      <ul className="mt-1 text-xs space-y-0.5">{report.unpublished_weeks.map((w) => <li key={w.week_start}>{fmtDate(w.week_start)} – {fmtDate(w.week_end)}: {STATUS[w.status] || w.status}{w.assigned_shift_count ? ` · ${w.assigned_shift_count} משמרות משובצות` : ""}</li>)}</ul>
      <div className="text-[11px] mt-1">שעות של שבועות אלה מוצגות בנפרד כ"טיוטה" ואינן נכללות בשעות שפורסמו.</div>
    </div>}
    {warnings.length > 0 && <div className="rounded-xl border border-orange-200 bg-orange-50 text-sm text-orange-900">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 font-semibold">
        <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {warnings.length} אזהרות לבדיקה (חפיפות, משמרות ארוכות, שעות לא תקינות)</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <ul className="px-4 pb-3 text-xs space-y-1">{warnings.map((w, i) => <li key={i}>{w.date ? `${fmtDate(w.date)} · ` : ""}{w.worker_name ? `${w.worker_name} · ` : ""}{w.message}</li>)}</ul>}
    </div>}
    {(ex.unassigned > 0 || ex.missing_schedule > 0) && <p className="text-[11px] text-slate-400">לא נספרו: {ex.unassigned} משמרות ללא עובד משובץ (כגון ניקיון לפי כמות){ex.missing_schedule ? ` · ${ex.missing_schedule} משמרות ללא סידור שבועי` : ""}.</p>}
  </div>;
}