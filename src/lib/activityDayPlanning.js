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
  UNVERIFIABLE: { label: "לא ניתן לאמת", cls: "bg-purple-50 text-purple-700 border-purple-200" },
};

export const GROUP_TYPE_LABELS = { LODGING: "לינה", DAY_USE: "ביקור יומי" };

// Date-only eligibility, computed by the backend; clock times never matter here.
export const isSelectable = (g) => g?.presence?.state === "PRESENT";

export const stationFromTemplate = (s) => ({
  station_id: s.station_id, title: s.title || "", start_time: s.start_time || "", end_time: s.end_time || "",
  space_id: s.suggested_space_id || "", removed: false, groups: [],
  ...Object.fromEntries(LOGISTICS_KEYS.map(k => [k, s[k] ?? null])),
});

export const toPreviewStations = (stations) => stations.filter(s => !s.removed).map(s => ({
  station_id: s.station_id, title: s.title, start_time: s.start_time, end_time: s.end_time, space_id: s.space_id,
  groups: s.groups.map(group_id => ({ group_id })),
  ...Object.fromEntries(LOGISTICS_KEYS.map(k => [k, s[k]])),
}));

// Each selected group counted once, however many stations it joins. Informational only.
export function uniqueGroupsSummary(stations, groupsById) {
  const ids = [...new Set(stations.filter(s => !s.removed).flatMap(s => s.groups))];
  let total = 0, unknown = 0;
  for (const id of ids) {
    const n = Number(groupsById[id]?.participant_count);
    if (Number.isFinite(n) && n > 0) total += n; else unknown += 1;
  }
  return { group_count: ids.length, registered_participants: total, unknown_count: unknown };
}