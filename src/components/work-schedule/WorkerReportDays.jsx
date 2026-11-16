import { Moon } from "lucide-react";

// Day list of one worker card in the "לפי עובדים" report (shared by the one-week and multi-week views).
export default function WorkerReportDays({ days }) {
  return (
    <div className="space-y-3">
      {days.map((day) => (
        <div key={day.date} className="border-r-4 border-primary/30 pr-3">
          <div className="text-sm font-bold text-slate-700">{day.dayName} <span className="text-slate-400 font-normal">{day.dateLabel}</span></div>
          {day.shifts.map((shift) => shift.isNight ? (
            <div key={shift.id} className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-950 text-white px-2 py-0.5 text-xs font-semibold">
              <Moon className="w-3 h-3" /> כונן לילה
            </div>
          ) : (
            <div key={shift.id} className="text-sm text-slate-700 mt-1">{shift.label}{shift.time && ` · ${shift.time}`}{shift.notes && <span className="text-slate-500"> · {shift.notes}</span>}</div>
          ))}
        </div>
      ))}
    </div>
  );
}