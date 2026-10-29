// Shared read-only helpers for the private logistics assistant.
export const LOGISTICS_MANAGER_EMAIL = 'hospitality@glow-glamping.com';

export function isLogisticsManagerEmail(email) {
  return String(email || '').trim().toLowerCase() === LOGISTICS_MANAGER_EMAIL;
}

const clean = (v) => (typeof v === 'string' ? (v.trim() || null) : (v ?? null));

const parseJson = (v) => {
  if (!v || typeof v !== 'string') return v || null;
  try { return JSON.parse(v); } catch { return v; }
};

// Operational (non-food, non-housekeeping) profile notes and planned requirements.
export function profileOperationalInfo(p) {
  if (!p) return null;
  return {
    general_notes: clean(p.general_notes),
    student_sleeping_notes: clean(p.student_sleeping_notes),
    staff_sleeping_notes: clean(p.staff_sleeping_notes),
    accessibility_sleeping_notes: clean(p.accessibility_sleeping_notes),
    tent_distribution_notes: parseJson(p.tent_distribution_notes),
    vip_tent_requirements: parseJson(p.vip_tent_requirements_json),
    staff_alt_tent_pax: p.staff_alt_tent_pax ?? null,
    staff_alt_tent_notes: clean(p.staff_alt_tent_notes),
    boys_count: p.boys_count ?? null,
    girls_count: p.girls_count ?? null,
    staff_men_count: p.staff_men_count ?? null,
    staff_women_count: p.staff_women_count ?? null,
    drivers_men_count: p.drivers_men_count ?? null,
    drivers_women_count: p.drivers_women_count ?? null,
  };
}

export function mapAllocation(a, tentMap, nbMap) {
  const tent = tentMap[a.tent_id];
  const nb = nbMap[a.neighborhood_id || tent?.neighborhood_id];
  return {
    tent: tent?.code || a.tent_id,
    tent_type: tent?.tent_type || null,
    neighborhood: nb?.name || null,
    is_vip: tent?.tent_type === 'VIP' || !!nb?.is_vip,
    allocated_pax: a.allocated_pax,
    allocation_type: a.allocation_type,
    gender_group: a.gender_group,
    nights_from: a.arrival_date,
    checkout: a.departure_date,
    stay_period_id: a.stay_period_id || null,
    notes: clean(a.notes),
  };
}

export function mapActivity(s, spaceMap) {
  return {
    id: s.id,
    date: s.date,
    activity_name: s.activity_name,
    start_time: s.start_time,
    end_time: s.end_time,
    space_name: s.activity_space_id ? (spaceMap[s.activity_space_id]?.name || s.activity_space_code || null) : null,
    requested_location: s.requested_location || null,
    pax: s.pax,
    needs: ['projector', 'screen', 'microphone', 'sound', 'whiteboard', 'chair_circle'].filter(k => s[`needs_${k}`]),
    chairs_count: s.chairs_count ?? null,
    logistics_other: clean(s.logistics_other),
    notes: clean(s.notes),
    is_shared_activity: !!s.is_shared_activity,
    shared_with: s.is_shared_activity ? parseJson(s.shared_activity_group_names) : null,
  };
}

export function mapCoffee(c) {
  return {
    id: c.id,
    date: c.date,
    start_time: c.start_time,
    end_time: c.end_time,
    pax: c.pax,
    type: c.coffee_corner_type === 'HOT_WATER_THERMOCAN_ONLY' ? 'מיחם וטרמוקן בלבד' : c.coffee_corner_type,
    location: c.location_name_snapshot || null,
    notes: clean(c.notes),
  };
}

export function mapSpaceRequest(r) {
  return {
    id: r.id,
    date: r.date,
    space_name: r.space_name,
    start_time: r.start_time,
    end_time: r.end_time,
    activity_title: r.activity_title,
    participants_count: r.participants_count ?? null,
    status: r.status,
    needs: ['projector', 'screen', 'microphone', 'sound', 'whiteboard', 'chair_circle'].filter(k => r[`needs_${k}`]),
    logistics_other: clean(r.logistics_other),
    notes: clean(r.notes),
  };
}

export function mapMaintenance(m) {
  return {
    id: m.id,
    title: m.title,
    description: clean(m.description),
    internal_notes: clean(m.internal_notes),
    category: m.category,
    priority: m.priority,
    status: m.status,
    location_name: m.location_name,
    location_section: m.location_section,
    related_group_name: m.related_group_name || null,
    assigned_to_name: m.assigned_to_name || null,
    created_date: m.created_date,
  };
}

export function mapBrief(b) {
  if (!b) return null;
  return {
    date: b.date,
    status: b.status,
    general_notes: clean(b.manual_general_notes),
    logistics_tasks: clean(b.manual_logistics_tasks),
    maintenance_tasks: clean(b.manual_maintenance_tasks),
    duty_students_notes: clean(b.manual_duty_students_notes),
    activity_spaces_notes: clean(b.manual_activity_spaces_notes),
    final_notes: clean(b.manual_final_notes),
  };
}