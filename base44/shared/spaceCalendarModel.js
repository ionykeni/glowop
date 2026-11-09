// Read-only display model for the visual common-spaces calendar.
// Pure function: receives raw records, returns only display-safe fields.
import { isGroupOperationallyEnabled } from './groupOperationalIsolation.js';

const BLOCK_REASON_LABELS = { PAINTING: 'צביעה', MAINTENANCE: 'תחזוקה', REPAIR: 'תיקון', SPECIAL_CLEANING: 'ניקיון מיוחד', TEMPORARILY_CLOSED: 'סגור זמנית', OTHER: 'חסימה' };
const SPACE_STATUS_LABELS = { BROKEN: 'תקול', MAINTENANCE: 'בתחזוקה', CLOSED: 'סגור' };

const inRange = (date, start, end) => !!date && date >= start && date <= end;

function groupType(group, mechinaIds) {
  if (mechinaIds.has(group.id)) return 'MECHINA';
  return group.group_type === 'DAY_USE' ? 'DAY_USE' : 'LODGING';
}

function presentSpace(space) {
  const working = !space.working_status || space.working_status === 'WORKING';
  const available = working && space.is_bookable !== false;
  return {
    id: space.id, name: space.name || 'מרחב ללא שם', code: space.code || '', space_type: space.space_type || '',
    capacity: space.capacity ?? null, available,
    unavailable_label: available ? null : (SPACE_STATUS_LABELS[space.working_status] || 'לא זמין להזמנה'),
  };
}

export function buildSpaceCalendar({ spaces = [], scheduleItems = [], groups = [], mechinaGroupIds = [], standalone = [], assignments = [], blocks = [], requests = [], start, end }) {
  const mechinaIds = new Set(mechinaGroupIds);
  const groupById = new Map(groups.filter(isGroupOperationallyEnabled).map(g => [g.id, g]));
  const spaceIds = new Set(spaces.map(s => s.id));
  const events = new Map();

  for (const item of scheduleItems) {
    const group = groupById.get(item.group_id);
    if (item.status !== 'ACTIVE' || !group || !spaceIds.has(item.activity_space_id) || !inRange(item.date, start, end)) continue;
    const key = item.shared_activity_id
      ? `shared:${item.shared_activity_id}|${item.activity_space_id}|${item.date}|${item.start_time}|${item.end_time}`
      : `item:${item.id}`;
    const existing = events.get(key);
    if (existing) {
      if (!existing.group_ids.includes(group.id)) {
        existing.group_ids.push(group.id);
        existing.group_names.push(group.group_name || '—');
        existing.pax = (existing.pax || 0) + (Number(item.pax) || 0) || null;
      }
      continue;
    }
    events.set(key, {
      id: key, source_id: item.id, kind: 'GROUP', status: 'CONFIRMED', space_id: item.activity_space_id,
      date: item.date, start_time: item.start_time, end_time: item.end_time, title: item.activity_name || 'פעילות',
      group_ids: [group.id], group_names: [group.group_name || '—'], group_type: groupType(group, mechinaIds),
      pax: Number(item.pax) || null, shared: !!item.shared_activity_id,
    });
  }

  const confirmedSourceIds = new Set([...events.values()].map(e => e.source_id));
  for (const request of requests) {
    if (request.status !== 'PENDING' || !spaceIds.has(request.space_id) || !inRange(request.date, start, end)) continue;
    if (request.approved_schedule_item_id && confirmedSourceIds.has(request.approved_schedule_item_id)) continue;
    const group = groupById.get(request.mechina_group_id);
    if (!group) continue;
    events.set(`request:${request.id}`, {
      id: `request:${request.id}`, source_id: request.id, kind: 'MECHINA_REQUEST', status: 'PENDING', space_id: request.space_id,
      date: request.date, start_time: request.start_time, end_time: request.end_time, title: request.activity_title || 'בקשה',
      group_ids: [group.id], group_names: [group.group_name || '—'], group_type: 'MECHINA',
      pax: Number(request.participants_count) || null, shared: false,
    });
  }

  const reservationById = new Map(standalone.map(r => [r.id, r]));
  for (const assignment of assignments) {
    const reservation = reservationById.get(assignment.reservation_id);
    if (!reservation || reservation.status !== 'ACTIVE' || !spaceIds.has(assignment.activity_space_id) || !inRange(reservation.event_date, start, end)) continue;
    const key = `standalone:${reservation.id}|${assignment.activity_space_id}`;
    if (events.has(key)) continue;
    events.set(key, {
      id: key, source_id: reservation.id, kind: 'STANDALONE', status: 'CONFIRMED', space_id: assignment.activity_space_id,
      date: reservation.event_date, start_time: reservation.start_time, end_time: reservation.end_time, title: reservation.title || 'פעילות כללית',
      group_ids: [], group_names: [], group_type: 'GENERAL', pax: Number(reservation.expected_pax) || null, shared: false,
    });
  }

  const presentBlocks = blocks
    .filter(b => b.status === 'ACTIVE' && spaceIds.has(b.activity_space_id) && b.start_date && b.start_date <= end && (b.is_open_ended || (b.end_date && b.end_date >= start)))
    .map(b => ({ id: b.id, space_id: b.activity_space_id, start_date: b.start_date, start_time: b.start_time || '00:00', end_date: b.is_open_ended ? null : b.end_date, end_time: b.is_open_ended ? null : (b.end_time || '23:59'), is_open_ended: !!b.is_open_ended, reason_label: BLOCK_REASON_LABELS[b.reason_type] || 'חסימה' }));

  return {
    spaces: spaces.map(presentSpace),
    events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date) || String(a.start_time).localeCompare(String(b.start_time))),
    blocks: presentBlocks,
  };
}