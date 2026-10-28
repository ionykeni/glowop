import { Moon, StickyNote, CalendarPlus } from "lucide-react";
import { ROW_BY_TYPE, fmtDM, fmtShiftTime, getWeekDays } from "@/lib/workScheduleConfig";
import { buildGoogleCalendarUrl } from "@/lib/shiftCalendarExport";

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export default function WeeklyShiftDays({ weekStart, shifts }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
    {getWeekDays(weekStart).map((date, index) => {
      const dayShifts = shifts.filter((shift) => shift.date === date);
      return <section key={date} className="rounded-xl border border-slate-200 bg-white p-3 min-h-36">
        <div className="border-b border-slate-100 pb-2 mb-2"><b>{DAYS[index]}</b><div className="text-xs text-slate-400">{fmtDM(date)}</div></div>
        {dayShifts.length === 0 ? <div className="text-xs text-slate-400 py-4 text-center">אין משמרת</div> : <div className="space-y-2">{dayShifts.map((shift) => {
          const row = ROW_BY_TYPE[shift.row_type] || {};
          const gcal = buildGoogleCalendarUrl(shift);
          return <div key={shift.id} className={`rounded-lg border p-2 text-xs ${row.chip || "bg-slate-50 border-slate-200"}`}>
            <div className="font-bold">{shift.row_label || row.label}</div>
            <div className="font-mono mt-1" dir="ltr">{fmtShiftTime(shift.start_time, shift.end_time)}</div>
            {shift.row_type === "NIGHT_ON_CALL" && <div className="flex items-center gap-1 mt-1 font-semibold"><Moon className="w-3 h-3" /> כונן לילה</div>}
            {shift.auto_created_from === "OPERATIONS_EVENING_TO_NIGHT_ON_CALL" && <div className="mt-1 text-[10px]">מחובר למשמרת תפעול ערב</div>}
            {shift.notes && <div className="flex gap-1 mt-1 text-[11px]"><StickyNote className="w-3 h-3 shrink-0" /><span>{shift.notes}</span></div>}
            <div className="mt-1 flex justify-end"><a href={gcal} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-700 hover:underline"><CalendarPlus className="w-3 h-3" /> הוסף ליומן Google</a></div>
          </div>;
        })}</div>}
      </section>;
    })}
  </div>;
}