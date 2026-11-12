import { base44 } from "@/api/base44Client";

// Calls a secured workforce backend function and surfaces the server's own error message.
export async function invokeWorkforce(functionName, payload) {
  try {
    const res = await base44.functions.invoke(functionName, payload);
    return res.data;
  } catch (err) {
    throw new Error(err?.response?.data?.error || err?.message || "שגיאה");
  }
}