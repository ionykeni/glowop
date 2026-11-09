import { base44 } from "@/api/base44Client";

// All template reads/writes go through the backend (entity RLS blocks direct access).
// Returns the function payload; validation/permission failures come back as { success: false, error, errors? }.
export async function callTemplates(action, payload = {}) {
  try {
    const res = await base44.functions.invoke("manageActivityDayTemplates", { action, ...payload });
    return res.data;
  } catch (error) {
    const data = error?.response?.data;
    if (data && data.success === false) return data;
    throw error;
  }
}

export const newStation = () => ({
  station_id: crypto.randomUUID(),
  title: "", description: "", start_time: "", end_time: "", suggested_space_id: "",
  needs_projector: false, needs_screen: false, needs_microphone: false, needs_sound: false,
  needs_whiteboard: false, needs_chair_circle: false, chairs_count: "", logistics_other: "", preparation_notes: "",
});