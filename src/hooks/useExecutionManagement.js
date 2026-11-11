import { useQuery, useQueryClient } from "@tanstack/react-query";
import { callManage } from "@/lib/activityDayManageApi";

// Loads one confirmed activity day and runs C2 operations against it.
// After every write (success or not) the day is reloaded from the server, so the screen never trusts local state.
export default function useExecutionManagement(executionId) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["activity-day-execution", executionId],
    queryFn: async () => {
      const r = await callManage("get", { execution_id: executionId });
      if (!r.success) throw new Error(r.error || "שגיאה בטעינה");
      return r;
    },
    enabled: !!executionId,
  });

  const reload = async () => {
    qc.invalidateQueries({ queryKey: ["activity-day-executions"] });
    const r = await query.refetch();
    return r.data?.execution;
  };

  // Write operations. Resolves to { ok, message, result }. An UNKNOWN outcome is resolved by reading the day back.
  const run = async (action, payload) => {
    const result = await callManage(action, { execution_id: executionId, ...payload });
    const fresh = await reload();
    if (result.success) return { ok: true, result };
    if (result.outcome === "UNKNOWN" && payload.op_id) {
      if (fresh?.history?.some(h => h.op_id === payload.op_id)) return { ok: true, result: { outcome: "COMPLETED" } };
      if (fresh?.operation?.op_id === payload.op_id) return { ok: false, message: "התשובה לא התקבלה והפעולה לא הושלמה. ניתן להשלים או לשחזר אותה מהמסך", result };
      return { ok: false, message: "התשובה לא התקבלה והפעולה לא בוצעה. ניתן לנסות שוב", result };
    }
    return { ok: false, message: result.error, result };
  };

  return { ...query, execution: query.data?.execution, today: query.data?.today, run, reload };
}