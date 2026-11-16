import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { invokeWorkforce } from "@/lib/workforceApi";
import { ROW_BY_TYPE, fmtShiftTime } from "@/lib/workScheduleConfig";

const SHIFT_TYPES = ["OPERATIONS_MORNING", "OPERATIONS_EVENING", "NIGHT_ON_CALL"];

export default function DashboardOperationsShifts({ selectedDate }) {
  // Server returns only the operations rows of the day, with worker names already resolved
  const { data: shifts = [] } = useQuery({
    queryKey: ["dashboardOperationsShifts", selectedDate],
    queryFn: async () => (await invokeWorkforce("getWorkScheduleView", { action: "dashboard_day", date: selectedDate })).shifts || [],
  });
  const relevantShifts = shifts.filter(shift => SHIFT_TYPES.includes(shift.row_type));
  if (relevantShifts.length === 0) return null;

  return (
    <section className="space-y-3" dir="rtl">
      <h2 className="flex items-center gap-2 border-b border-border pb-1.5 text-base font-bold text-foreground">
        <UsersRound className="h-4 w-4 text-slate-500" />
        צוות תפעול בבית (מסידור עבודה)
      </h2>
      <div className="flex flex-wrap gap-2">
        {SHIFT_TYPES.map(type => {
          const typeShifts = relevantShifts.filter(item => item.row_type === type);
          const meta = ROW_BY_TYPE[type];
          const workerNames = typeShifts.map(shift => shift.worker_name).filter(Boolean);
          const times = [...new Set(typeShifts.map(shift => fmtShiftTime(shift.start_time, shift.end_time)).filter(Boolean))];
          return (
            <div key={type} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${meta.chip}`}>
              <span className="font-semibold opacity-75">{meta.label}</span>
              <span className="font-bold">{workerNames.length ? workerNames.join(" · ") : "לא שובץ"}</span>
              {times.length > 0 && <span className="opacity-65" dir="ltr">{times.join(" / ")}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}