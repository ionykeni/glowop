import { base44 } from "@/api/base44Client";

// Read-only planner backend. Returns the payload; failures come back as { success: false, error }.
export async function callPlanner(action, payload = {}) {
  try {
    const res = await base44.functions.invoke("planActivityDayFromTemplate", { action, ...payload });
    return res.data;
  } catch (error) {
    const data = error?.response?.data;
    if (data && data.success === false) return data;
    throw error;
  }
}

export const LOGISTICS_KEYS = ["needs_projector", "needs_screen", "needs_microphone", "needs_sound", "needs_whiteboard", "needs_chair_circle", "chairs_count", "logistics_other"];

export const STATUS_META = {
  AVAILABLE: { label: "פנוי", cls: "bg-green-50 text-green-700 border-green-200" },
  BOOKED: { label: "תפוס", cls: "bg-red-50 text-red-700 border-red-200" },
  PENDING: { label: "ממתין", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  UNAVAILABLE: { label: "לא זמין", cls: "bg-slate-200 text-slate-700 border-slate-300" },
  OVER_CAPACITY: { label: "חריגה מקיבולת", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  UNVERIFIABLE: { label: "לא ניתן לאמת", cls: "bg-purple-50 text-purple-700 border-purple-200" },
};

export const isSelectable = (g) => g?.presence?.state === "FULL_DAY" || g?.presence?.state === "PARTIAL";

// Fast local hint only — the backend preview is authoritative.
export function localStationCheck(group, start, end) {
  if (!isSelectable(group)) return "הקבוצה אינה זכאית בתאריך זה";
  if (!start || !end) return "שעות התחנה חסרות";
  if (start < group.presence.from || end > group.presence.to) return `מחוץ לשעות השהייה (${group.presence.from}–${group.presence.to})`;
  return null;
}

export const stationFromTemplate = (s) => ({
  station_id: s.station_id, title: s.title || "", start_time: s.start_time || "", end_time: s.end_time || "",
  space_id: s.suggested_space_id || "", removed: false, groups: {},
  ...Object.fromEntries(LOGISTICS_KEYS.map(k => [k, s[k] ?? null])),
});

export const toPreviewStations = (stations) => stations.filter(s => !s.removed).map(s => ({
  station_id: s.station_id, title: s.title, start_time: s.start_time, end_time: s.end_time, space_id: s.space_id,
  groups: Object.entries(s.groups).map(([group_id, participants]) => ({ group_id, participants: participants === "" ? null : Number(participants) })),
  ...Object.fromEntries(LOGISTICS_KEYS.map(k => [k, s[k]])),
}));

export const stationTotal = (station) =>
  Object.values(station.groups).reduce((sum, v) => sum + (v === "" || isNaN(Number(v)) ? 0 : Number(v)), 0);