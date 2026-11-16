import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeWorkforce } from "@/lib/workforceApi";

export function usePmTasks() {
  return useQuery({
    queryKey: ["pm-tasks"],
    queryFn: () => invokeWorkforce("manageRecurringMaintenanceTasks", { action: "list" }),
  });
}

export function usePmTaskMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => invokeWorkforce("manageRecurringMaintenanceTasks", payload),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ["pm-tasks"] }),
      qc.invalidateQueries({ queryKey: ["pm-overview"] }),
    ]),
  });
}