import { AlertTriangle } from "lucide-react";
import { WEEK_STATUS_LABEL, weekLabel, unpublishedListText } from "@/lib/multiWeekTeamReport";

const CHIP_STYLE = {
  PUBLISHED: "bg-green-50 text-green-800 border-green-200",
  DRAFT: "bg-amber-50 text-amber-800 border-amber-200",
  ARCHIVED: "bg-amber-50 text-amber-800 border-amber-200",
  MISSING: "bg-slate-100 text-slate-600 border-slate-200",
};

// Published / not-published state of every selected week, plus the export warning.
export default function PeriodWeekStatus({ report }) {
  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex gap-2 flex-wrap">
        {report.statuses.map((week) => (
          <span key={week.weekStart} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHIP_STYLE[week.status] || CHIP_STYLE.MISSING}`}>
            שבוע {weekLabel(week.weekStart)} · {WEEK_STATUS_LABEL[week.status] || week.status}{week.status !== "PUBLISHED" && " – לא ייכלל"}
          </span>
        ))}
      </div>
      {report.unpublished.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>הטווח כולל שבועות שטרם פורסמו: {unpublishedListText(report)}. המשמרות שלהם אינן מוצגות ולא ייכללו ב-PDF, והמסמך יסומן כחלקי.</span>
        </div>
      )}
    </div>
  );
}