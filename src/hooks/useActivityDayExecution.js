import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callExecutor, loadPendingKey, savePendingKey, clearPendingKey } from "@/lib/activityDayExecution";

// Durable execution identity: the key is stored before the request is sent, so a refresh or timeout
// can always look up what actually happened instead of guessing.
export default function useActivityDayExecution(templateId) {
  const queryClient = useQueryClient();
  const [execution, setExecution] = useState(null);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState(null); // { outcome, error, blockers }

  const refreshCalendar = () => queryClient.invalidateQueries({ queryKey: ["space-visual-calendar"] });

  const checkStatus = async (key = loadPendingKey(templateId)) => {
    if (!key) return null;
    setChecking(true);
    const res = await callExecutor("status", { execution_key: key });
    setChecking(false);
    if (res.success && res.execution) { setExecution(res.execution); setProblem(null); return res.execution; }
    if (res.success && !res.execution) { clearPendingKey(templateId); setExecution(null); }
    if (!res.success) setProblem({ outcome: "UNKNOWN", error: "לא ניתן לאמת את מצב הביצוע — נסה לבדוק שוב" });
    return null;
  };

  useEffect(() => { if (templateId) checkStatus(); }, [templateId]);

  const handle = async (res, key) => {
    if (res.execution) setExecution(res.execution);
    if (res.success) { setProblem(null); refreshCalendar(); return; }
    if (res.outcome === "UNKNOWN") {
      const found = await checkStatus(key);
      if (!found) setProblem({ outcome: "UNKNOWN", error: "לא התקבלה תשובה, ולא נמצא ביצוע שמור. ניתן לנסות שוב בבטחה — אותו מזהה ביצוע ישמש שוב." });
      return;
    }
    if (!res.execution && res.outcome !== "BUSY") clearPendingKey(templateId);
    if (res.execution) refreshCalendar();
    setProblem({ outcome: res.outcome, error: res.error, blockers: res.blockers || [] });
  };

  const execute = async (payload) => {
    const key = loadPendingKey(templateId) || crypto.randomUUID();
    savePendingKey(templateId, key);
    setRunning(true); setProblem(null);
    const res = await callExecutor("execute", { ...payload, execution_key: key, confirmed: true });
    await handle(res, key);
    setRunning(false);
  };

  const resume = async () => {
    const key = execution?.execution_key || loadPendingKey(templateId);
    setRunning(true); setProblem(null);
    const res = await callExecutor("resume", { execution_key: key });
    await handle(res, key);
    setRunning(false);
  };

  const startNew = () => { clearPendingKey(templateId); setExecution(null); setProblem(null); };

  return { execution, running, checking, problem, execute, resume, checkStatus, startNew };
}