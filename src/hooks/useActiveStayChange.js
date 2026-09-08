import { useState } from "react";
import { base44 } from "@/api/base44Client";

const PERIOD_FIELDS = ["id", "client_key", "start_date", "end_date", "arrival_time", "departure_time", "notes", "status"];
const payloadPeriods = periods => periods.map(period => {
  const source = period._stored
    ? { ...period._stored, ...Object.fromEntries((period._dirty_fields || []).map(field => [field, period[field]])) }
    : period;
  return Object.fromEntries(PERIOD_FIELDS.filter(field => source[field] !== undefined).map(field => [field, source[field]]));
});
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
    const data = await run("previewActiveMultiPeriodStayChangeV2", periods);
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