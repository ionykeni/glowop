import { base44 } from "@/api/base44Client";

// Execution backend. Returns the payload; failures with a body come back as { success: false, ... }.
// A transport failure (timeout / network) resolves to { success: false, outcome: "UNKNOWN" } — the caller
// must then check the execution status before offering a retry.
export async function callExecutor(action, payload = {}) {
  try {
    const res = await base44.functions.invoke("executeActivityDayFromTemplate", { action, ...payload });
    return res.data;
  } catch (error) {
    const data = error?.response?.data;
    if (data && data.success === false) return data;
    return { success: false, outcome: "UNKNOWN", error: "לא התקבלה תשובה מהשרת" };
  }
}

const storageKey = (templateId) => `activity-day-exec:${templateId}`;
export const loadPendingKey = (templateId) => localStorage.getItem(storageKey(templateId));
export const savePendingKey = (templateId, key) => localStorage.setItem(storageKey(templateId), key);
export const clearPendingKey = (templateId) => localStorage.removeItem(storageKey(templateId));

export const HARD_STATUSES = ["UNAVAILABLE", "BOOKED", "UNVERIFIABLE"];
export const calendarLink = (date) => `/common-spaces?tab=visual&date=${date}`;