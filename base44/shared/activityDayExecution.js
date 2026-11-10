// Pure helpers for executing a confirmed activity day. No I/O here.
// Model: one logical station = one shared_activity_id; one GroupScheduleItem per participating Group,
// all carrying that same shared_activity_id (the existing shared-activity model). The common-space
// calendar collapses them into one physical occupancy.

export const HARD_STATUSES = new Set(['UNAVAILABLE', 'BOOKED', 'UNVERIFIABLE']);
export const isExecutionKey = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Stable, order-preserving description of the plan used for the idempotency fingerprint.
export function planFingerprintSource(templateId, version, date, stations) {
  return JSON.stringify({
    t: templateId, v: version, d: date,
    s: stations.map(s => [s.station_id, s.title, s.start_time, s.end_time, s.space_id, s.groups.map(g => g.group_id).sort()]),
  });
}

// Split preview results into hard blockers (stop) and nonblocking warnings (pending requests).
export function classifyPreview(previewStations) {
  const blockers = [], warnings = [];
  for (const st of previewStations) {
    const hard = st.issues.filter(i => HARD_STATUSES.has(i.status));
    const soft = st.issues.filter(i => i.status === 'PENDING');
    const base = { station_id: st.station_id, title: st.title, space_name: st.space_name, start_time: st.start_time, end_time: st.end_time };
    if (hard.length) blockers.push({ ...base, reasons: hard.map(i => i.message) });
    if (soft.length) warnings.push({ ...base, reasons: soft.map(i => i.message) });
  }
  return { blockers, warnings };
}

export function activityName(templateName, stationTitle) {
  const t = String(templateName || '').trim(), s = String(stationTitle || '').trim();
  return s && t ? `${t} — ${s}` : (s || t || 'פעילות');
}

// One GroupScheduleItem payload for one Group in one station. No pax/capacity data by design.
export function buildScheduleItemPayload({ station, groupId, profileId, execution, logisticsKeys }) {
  const logistics = Object.fromEntries(logisticsKeys.map(k => [k, station.logistics?.[k] ?? null]));
  return {
    group_id: groupId,
    operational_group_profile_id: profileId,
    date: execution.date,
    start_time: station.start_time,
    end_time: station.end_time,
    activity_name: activityName(execution.template_name, station.title),
    activity_space_id: station.space_id,
    activity_space_code: station.space_code || null,
    shared_activity_id: station.shared_activity_id,
    shared_activity_created_from_group_id: station.groups[0]?.group_id || groupId,
    shared_activity_group_ids: JSON.stringify(station.groups.map(g => g.group_id)),
    shared_activity_group_names: JSON.stringify(station.groups.map(g => g.group_name)),
    is_shared_activity: true,
    pax: null,
    notes: `נוצר מתבנית יום פעילות "${execution.template_name}" (גרסה ${execution.template_version})`,
    needs_projector: !!logistics.needs_projector,
    needs_screen: !!logistics.needs_screen,
    needs_microphone: !!logistics.needs_microphone,
    needs_sound: !!logistics.needs_sound,
    needs_whiteboard: !!logistics.needs_whiteboard,
    needs_chair_circle: !!logistics.needs_chair_circle,
    chairs_count: Number(logistics.chairs_count) > 0 ? Number(logistics.chairs_count) : null,
    logistics_other: logistics.logistics_other || null,
    source: 'manual',
    status: 'ACTIVE',
  };
}

// Recovery: which groups of a station still lack an ACTIVE item for this station's shared_activity_id.
// Items found in the datastore are adopted, so a lost response never produces a duplicate.
export function reconcileStation(station, existingItems) {
  const items = { ...(station.items || {}) };
  for (const it of existingItems) {
    if (it.shared_activity_id === station.shared_activity_id && it.status === 'ACTIVE' && !items[it.group_id]) items[it.group_id] = it.id;
  }
  const missing = station.groups.map(g => g.group_id).filter(gid => !items[gid]);
  return { items, missing };
}

export function executionCounts(stations) {
  const expected = stations.reduce((n, s) => n + s.groups.length, 0);
  const created = stations.reduce((n, s) => n + Object.keys(s.items || {}).length, 0);
  const done = stations.filter(s => s.groups.every(g => s.items?.[g.group_id])).length;
  return { expected_items: expected, created_items: created, completed_stations: done, total_stations: stations.length };
}