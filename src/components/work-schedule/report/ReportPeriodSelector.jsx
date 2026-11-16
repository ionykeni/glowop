import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/workScheduleConfig";
import { TEAM_PERIOD_OPTIONS, fmtFullDate } from "@/lib/multiWeekTeamReport";

// Period for the weekly report: number of consecutive weeks + starting week.
export default function ReportPeriodSelector({ weekCount, onWeekCountChange, startWeek, onStartWeekChange, pageWeekStart }) {
  return (
    <div className="flex items-center gap-3 flex-wrap rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" dir="rtl">
      <span className="text-xs font-semibold text-slate-600">תקופה:</span>
      <div className="flex gap-1.5 flex-wrap">
        {TEAM_PERIOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onWeekCountChange(option.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              weekCount === option.value ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-primary/50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 mr-auto">
        <span className="text-xs text-slate-500">שבוע התחלה:</span>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="שבוע קודם" onClick={() => onStartWeekChange(addDays(startWeek, -7))}>
          <ChevronRight />
        </Button>
        <span className="text-sm font-bold text-slate-800 min-w-[84px] text-center" dir="ltr">{fmtFullDate(startWeek)}</span>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="שבוע הבא" onClick={() => onStartWeekChange(addDays(startWeek, 7))}>
          <ChevronLeft />
        </Button>
        {startWeek !== pageWeekStart && (
          <Button type="button" variant="link" size="sm" className="h-7 px-1 text-xs" onClick={() => onStartWeekChange(pageWeekStart)}>חזרה לשבוע המוצג</Button>
        )}
      </div>
    </div>
  );
}