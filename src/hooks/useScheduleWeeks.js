import { useQueries } from "@tanstack/react-query";
import { invokeWorkforce } from "@/lib/workforceApi";

// Loads the schedule + shifts of each given week through the same secured read used by the WorkSchedule page
// (same query key, so already-loaded weeks come from cache). Read-only.
export default function useScheduleWeeks(weekStarts, enabled) {
  const results = useQueries({
    queries: weekStarts.map((weekStart) => ({
      queryKey: ["workScheduleWeek", weekStart],
      queryFn: () => invokeWorkforce("getWorkScheduleView", { action: "week", week_start_date: weekStart }),
      enabled,
    })),
  });
  return {
    weeks: weekStarts.map((weekStart, i) => ({ weekStart, schedule: results[i].data?.schedule || null, shifts: results[i].data?.shifts || [] })),
    isLoading: enabled && results.some((r) => r.isLoading),
    error: results.find((r) => r.error)?.error || null,
  };
}