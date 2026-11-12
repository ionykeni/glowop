import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { invokeWorkforce } from "@/lib/workforceApi";
import { ROW_BY_TYPE, fmtShiftTime } from "@/lib/workScheduleConfig";

const SHIFT_TYPES = ["OPERATIONS_MORNING", "OPERATIONS_EVENING", "NIGHT_ON_CALL"];

export default function DashboardOperationsShifts({ selectedDate }) {
  const { data: shifts = [] } = useQuery({
    queryKey: ["dashboardOperationsShifts", selectedDate],
    queryFn: () => base44.entities.WorkShift.filter({ date: selectedDate, status: "PLANNED" }),
  });
  const relevantShifts = useMemo(() => shifts.filter(shift => SHIFT_TYPES.includes(shift.row_type)), [shifts]);
  // Names only, and only for shifts that lack a worker_name snapshot
  const missingNameIds = useMemo(() => [...new Set(relevantShifts.filter(s => !s.worker_name && s.worker_id).map(s => s.worker_id))].sort(), [relevantShifts]);
  const { data: workers = [] } = useQuery({
    queryKey: ["dashboardShiftWorkers", missingNameIds.join(",")],
    queryFn: async () => (await invokeWorkforce("getWorkerDirectory", { action: "names", worker_ids: missingNameIds })).workers,
    enabled: missingNameIds.length > 0,
  });
  const workerById = useMemo(() => Object.fromEntries(workers.map(worker => [worker.id, worker])), [workers]);
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
          const workerNames = typeShifts.map(shift =>
            shift.worker_name || workerById[shift.worker_id]?.full_name
          ).filter(Boolean);
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