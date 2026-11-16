import WorkerReportDays from "@/components/work-schedule/WorkerReportDays";
import PeriodWeekStatus from "@/components/work-schedule/report/PeriodWeekStatus";
import { weekLabel } from "@/lib/multiWeekTeamReport";

const WeekSeparator = ({ weekStart, count }) => (
  <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 mt-3 mb-2 first:mt-0">
    <span>שבוע {weekLabel(weekStart)}</span>
    <span className="h-px flex-1 bg-slate-200" />
    <span>{count} משמרות</span>
  </div>
);

// "לפי עובדים" for several consecutive weeks: same worker cards, days grouped under compact week separators.
export default function MultiWeekWorkersReport({ report }) {
  return (
    <div className="space-y-4" dir="rtl">
      <PeriodWeekStatus report={report} />
      {report.workers.length === 0 && <div className="rounded-xl border bg-slate-50 p-6 text-center text-sm text-slate-500">אין משמרות מפורסמות בתקופה שנבחרה</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {report.workers.map((worker) => (
          <section key={worker.key} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="mb-3">
              <h3 className="text-base font-bold text-slate-800">{worker.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{worker.totalShifts} משמרות בתקופה</p>
            </div>
            {worker.weeks.map((week) => (
              <div key={week.weekStart}>
                <WeekSeparator weekStart={week.weekStart} count={week.totalShifts} />
                <WorkerReportDays days={week.days} />
              </div>
            ))}
          </section>
        ))}
      </div>
      {report.cleaning.length > 0 && (
        <section className="bg-green-50 border border-green-200 rounded-2xl p-4">
          <h3 className="text-base font-bold text-green-900 mb-3">ניקיון קבלן</h3>
          {report.cleaning.map((week) => (
            <div key={week.weekStart}>
              <WeekSeparator weekStart={week.weekStart} count={week.days.length} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {week.days.map((day) => <div key={day.date} className="bg-white/70 border border-green-100 rounded-xl p-3 text-sm"><b>{day.dayName} {day.dateLabel}</b>{day.morning > 0 && <div>ניקיון בוקר: {day.morning} מנקות</div>}{day.evening > 0 && <div>ניקיון ערב: {day.evening} מנקות</div>}</div>)}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}