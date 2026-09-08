import { useState } from "react";
import { base44 } from "@/api/base44Client";

const payloadPeriods = periods => periods.map(({ _draft_id, ...period }) => period);
export default function useActiveStayChange(groupId, onApplied) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (name, periods, extra = {}) => {
    setBusy(true); setError("");
    try {
      const response = await base44.functions.invoke(name, { group_id: groupId, periods: payloadPeriods(periods), ...extra });
      return response.data;
    } catch (err) {
      setError(err?.response?.data?.error || "הפעולה נכשלה");
      return null;
    } finally { setBusy(false); }
  };
  const previewChange = async periods => {
    const data = await run("previewActiveMultiPeriodStayChange", periods);
    console.warn("Preview runtime version", data?.diagnostic_version, data);
    const blocker = data?.blocking_errors?.find(item => item.code === "STARTED_PERIOD_CANNOT_BE_REMOVED_OR_REWRITTEN");
    if (blocker) console.warn("Active stay started-period blocker diagnostic", blocker);
    if (data) setPreview({ ...data, request_id: crypto.randomUUID() });
  };
  const applyChange = async periods => {
    if (!preview?.request_id || !preview?.base_version) {
      setError("יש לבצע תצוגה מקדימה חדשה לפני האישור");
      return;
    }
    const data = await run("applyActiveMultiPeriodStayChange", periods, {
      confirmed: true,
      request_id: preview.request_id,
      base_version: preview.base_version,
      actions: {},
    });
    if (data?.success) onApplied?.(data);
  };
  const resetPreview = () => setPreview(null);
  return { preview, busy, error, previewChange, applyChange, resetPreview };
}