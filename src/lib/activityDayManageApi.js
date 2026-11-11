import { base44 } from "@/api/base44Client";

// C2 management backend. Failures with a body come back as { success: false, outcome, error }.
// A transport failure resolves to { success: false, outcome: "UNKNOWN" }: the caller must reload the
// activity day and check whether the operation was applied before offering a retry.
export async function callManage(action, payload = {}) {
  try {
    const res = await base44.functions.invoke("manageActivityDayExecutions", { action, ...payload });
    return res.data;
  } catch (error) {
    const data = error?.response?.data;
    if (data && data.success === false) return data;
    return { success: false, outcome: "UNKNOWN", error: "לא התקבלה תשובה מהשרת" };
  }
}

export const newOpId = () => crypto.randomUUID();
export const executionsListPath = "/activity-day-templates/executions";
export const executionPath = (id) => `/activity-day-templates/executions/${id}`;

export const OP_LABELS = { EDIT: "עריכת תחנה", EDIT_REVERTED: "שחזור עריכה", CANCEL_STATION: "ביטול תחנה", CANCEL_DAY: "ביטול יום הפעילות" };