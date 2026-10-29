import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import {
  isLogisticsManagerEmail, profileOperationalInfo, mapAllocation, mapActivity,
  mapCoffee, mapSpaceRequest, mapMaintenance,
} from '../../shared/logisticsAssistantData.js';

// READ-ONLY: full operational overview of one Group for the private logistics assistant.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isLogisticsManagerEmail(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const groupId = typeof body.group_id === 'string' ? body.group_id.trim() : '';
    const name = typeof body.group_name === 'string' ? body.group_name.trim().slice(0, 100) : '';
    if (!groupId && !name) return Response.json({ error: 'group_id or group_name is required' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    let group = null;
    if (groupId) {
      group = await db.Group.get(groupId).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    } else {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = (await db.Group.filter({ group_name: { $regex: escaped, $options: 'i' } }, '-arrival_date', 20))
        .filter(g => !['CANCELLED', 'ARCHIVED'].includes(g.status));
      const exact = matches.filter(g => g.group_name.trim() === name);
      if (exact.length === 1) group = exact[0];
      else if (matches.length === 1) group = matches[0];
      else if (matches.length > 1) {
        return Response.json({ found: false, ambiguous: true, candidates: matches.map(g => ({
          id: g.id, name: g.group_name, arrival_date: g.arrival_date, departure_date: g.departure_date || null, status: g.status,
        })) });
      }
    }
    if (!group) return Response.json({ found: false, ambiguous: false, candidates: [] });

    const gid = group.id;
    const [periods, profiles, items, coffee, allocs, nbRes, maint, spaceReqs, tents, neighborhoods, spaces] = await Promise.all([
      db.GroupStayPeriod.filter({ group_id: gid, status: 'ACTIVE' }),
      db.OperationalGroupProfile.filter({ group_id: gid }),
      db.GroupScheduleItem.filter({ group_id: gid, status: 'ACTIVE' }, 'date', 300),
      db.CoffeeCornerRequest.filter({ group_id: gid, status: 'ACTIVE' }, 'date', 200),
      db.SleepingAllocation.filter({ group_id: gid, status: 'CONFIRMED' }),
      db.NeighborhoodReservation.filter({ group_id: gid, status: 'ACTIVE' }),
      db.MaintenanceIssue.filter({ related_group_id: gid, status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'] } }),
      db.CommonSpaceBookingRequest.filter({ mechina_group_id: gid, status: { $in: ['PENDING', 'APPROVED', 'CHANGE_REQUESTED', 'CANCELLATION_REQUESTED'] } }, 'date', 200),
      db.Tent.list(),
      db.Neighborhood.list(),
      db.ActivitySpace.list(),
    ]);

    const tentMap = Object.fromEntries(tents.map(t => [t.id, t]));
    const nbMap = Object.fromEntries(neighborhoods.map(n => [n.id, n]));
    const spaceMap = Object.fromEntries(spaces.map(s => [s.id, s]));
    const byDateTime = (a, b) => `${a.date} ${a.start_time || ''}`.localeCompare(`${b.date} ${b.start_time || ''}`);

    return Response.json({
      found: true,
      group: {
        id: gid,
        name: group.group_name,
        status: group.status,
        group_type: group.group_type,
        stay_mode: group.stay_mode || 'CONTINUOUS',
        arrival_date: group.arrival_date,
        departure_date: group.departure_date || null,
        arrival_time: group.stay_mode === 'MULTI_PERIOD' ? null : (group.arrival_time || null),
        departure_time: group.stay_mode === 'MULTI_PERIOD' ? null : (group.departure_time || null),
        total_pax: group.total_pax ?? null,
        participant_count: group.participant_count ?? null,
        staff_count: group.staff_count ?? null,
        boys_count: group.boys_count ?? null,
        girls_count: group.girls_count ?? null,
        operationally_active: group.operationally_active !== false,
        contact_name: group.contact_name || null,
        contact_phone: group.contact_phone || null,
        contact_email: group.contact_email || null,
        internal_notes: group.internal_notes || null,
      },
      stay_periods: periods.sort((a, b) => a.start_date.localeCompare(b.start_date)).map(p => ({
        id: p.id, start_date: p.start_date, end_date: p.end_date,
        arrival_time: p.arrival_time || null, departure_time: p.departure_time || null, notes: p.notes || null,
      })),
      profile: profileOperationalInfo(profiles[0]),
      activities: items.map(s => mapActivity(s, spaceMap)).sort(byDateTime),
      coffee_corners: coffee.map(mapCoffee).sort(byDateTime),
      sleeping_allocations: allocs.map(a => mapAllocation(a, tentMap, nbMap))
        .sort((a, b) => a.nights_from.localeCompare(b.nights_from)),
      neighborhood_reservations: nbRes.map(r => ({
        neighborhood: nbMap[r.neighborhood_id]?.name || null,
        is_vip: !!nbMap[r.neighborhood_id]?.is_vip,
        nights_from: r.arrival_date, checkout: r.departure_date,
        gender_group: r.gender_group, planned_tents: r.planned_tents ?? null,
        shared_neighborhood_allowed: !!r.shared_neighborhood_allowed,
        shared_neighborhood_reason: r.shared_neighborhood_reason || null,
        notes: r.notes || null,
      })),
      common_space_requests: spaceReqs.map(mapSpaceRequest).sort(byDateTime),
      maintenance_open: maint.map(mapMaintenance),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}