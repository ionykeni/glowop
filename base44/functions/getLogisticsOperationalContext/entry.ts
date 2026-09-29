import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getJerusalemToday() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(now); // YYYY-MM-DD
}

function getJerusalemTime() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return fmt.format(now); // HH:MM
}

function nextDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// ── Main handler ────────────────────────────────────────────────────────────

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const date = body.date || getJerusalemToday();
    const fromTime = body.from_time || null;
    const tomorrow = nextDate(date);

    // ── Fetch groups (operationally active, non-cancelled) ──────────────────
    const allGroups = await base44.entities.Group.list('-created_date', 500);
    const groups = (allGroups || []).filter(g =>
      g.operationally_active !== false &&
      g.status !== 'CANCELLED' &&
      g.status !== 'ARCHIVED'
    );
    const groupMap = {};
    for (const g of groups) groupMap[g.id] = g;

    // ── Mechina group identification ────────────────────────────────────────
    const mechinaAssignments = await base44.entities.MechinaGroupAssignment.filter({ is_active: true });
    const mechinaGroupIds = new Set((mechinaAssignments || []).map(a => a.group_id));

    // ── Stay periods (active) ───────────────────────────────────────────────
    const allPeriods = await base44.entities.GroupStayPeriod.filter({ status: 'ACTIVE' });
    const periods = (allPeriods || []).filter(p => groupMap[p.group_id]);

    // ── Determine presence / arrivals / departures ──────────────────────────
    const present = [];
    const arrivals = [];
    const departures = [];
    const dayUse = [];

    for (const g of groups) {
      const gPeriods = periods.filter(p => p.group_id === g.id);
      const isPresent = gPeriods.some(p => p.start_date <= date && date <= p.end_date);
      const isArrival = gPeriods.some(p => p.start_date === date);
      const isDeparture = gPeriods.some(p => p.end_date === date);

      if (g.group_type === 'DAY_USE') {
        if (isPresent || isArrival) {
          dayUse.push({
            id: g.id,
            name: g.group_name,
            arrival_time: g.arrival_time,
            departure_time: g.departure_time,
            total_pax: g.total_pax,
            contact_name: g.contact_name,
            contact_phone: g.contact_phone,
            internal_notes: g.internal_notes,
            is_mechina: mechinaGroupIds.has(g.id),
          });
        }
        continue;
      }

      if (isPresent || isArrival || isDeparture) {
        const entry = {
          id: g.id,
          name: g.group_name,
          stay_mode: g.stay_mode,
          arrival_time: g.arrival_time,
          departure_time: g.departure_time,
          total_pax: g.total_pax,
          staff_count: g.staff_count,
          participant_count: g.participant_count,
          is_present: isPresent,
          is_arrival: isArrival,
          is_departure: isDeparture,
          is_mechina: mechinaGroupIds.has(g.id),
          periods: gPeriods.map(p => ({
            start_date: p.start_date,
            end_date: p.end_date,
            arrival_time: p.arrival_time,
            departure_time: p.departure_time,
          })),
        };
        present.push(entry);
        if (isArrival) arrivals.push(entry);
        if (isDeparture) departures.push(entry);
      }
    }

    // ── Sleeping allocations (check for zero-allocation groups) ──────────────
    const sleepingAllocs = await base44.entities.SleepingAllocation.filter({ status: 'CONFIRMED' });
    const allocGroupIds = new Set((sleepingAllocs || []).filter(a => groupMap[a.group_id]).map(a => a.group_id));

    const sleepingGroupsMissingAllocation = [];
    for (const g of groups) {
      if (g.group_type === 'DAY_USE') continue;
      const isArriving = arrivals.some(a => a.id === g.id);
      const isPresent = present.some(p => p.id === g.id && p.is_present);
      if ((isArriving || isPresent) && !allocGroupIds.has(g.id)) {
        sleepingGroupsMissingAllocation.push({
          id: g.id,
          name: g.group_name,
          is_arriving: isArriving,
          is_mechina: mechinaGroupIds.has(g.id),
        });
      }
    }

    // ── Coffee corners for the date ─────────────────────────────────────────
    const coffeeAll = await base44.entities.CoffeeCornerRequest.filter({ date, status: 'ACTIVE' });
    let coffeeCorners = (coffeeAll || []).filter(c => groupMap[c.group_id]);
    if (fromTime) {
      coffeeCorners = coffeeCorners.filter(c => !c.start_time || c.start_time >= fromTime);
    }
    const coffeeData = coffeeCorners.map(c => ({
      id: c.id,
      group_name: groupMap[c.group_id]?.group_name || c.group_id,
      start_time: c.start_time,
      end_time: c.end_time,
      pax: c.pax,
      type: c.coffee_corner_type,
      location: c.location_name_snapshot,
      notes: c.notes,
      is_mechina: mechinaGroupIds.has(c.group_id),
    }));

    // ── Maintenance issues (open) ────────────────────────────────────────────
    const maintIssues = await base44.entities.MaintenanceIssue.filter({
      status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'] },
    });
    const maintenanceOpen = (maintIssues || []).map(m => ({
      id: m.id,
      title: m.title,
      category: m.category,
      priority: m.priority,
      status: m.status,
      location_name: m.location_name,
      location_section: m.location_section,
      related_group_name: m.related_group_name,
      assigned_to_name: m.assigned_to_name,
    }));

    // ── Common spaces / activities needing preparation ──────────────────────
    const scheduleItems = await base44.entities.GroupScheduleItem.filter({ date, status: 'ACTIVE' });
    const spacesForPrep = (scheduleItems || [])
      .filter(s => groupMap[s.group_id] && !mechinaGroupIds.has(s.group_id) && s.activity_space_id)
      .map(s => ({
        id: s.id,
        group_name: groupMap[s.group_id]?.group_name || s.group_id,
        activity_name: s.activity_name,
        start_time: s.start_time,
        end_time: s.end_time,
        activity_space_id: s.activity_space_id,
        space_name: s.activity_space_code,
        pax: s.pax,
        needs_projector: s.needs_projector,
        needs_sound: s.needs_sound,
        needs_microphone: s.needs_microphone,
      }));

    // ── Activity space blocks for the date ──────────────────────────────────
    const spaceBlocks = await base44.entities.ActivitySpaceBlock.filter({
      status: 'ACTIVE',
    });
    const blocksForDate = (spaceBlocks || []).filter(b =>
      b.start_date <= date && (!b.end_date || date <= b.end_date)
    ).map(b => ({
      id: b.id,
      space_id: b.activity_space_id,
      space_name: b.activity_space_name_snapshot,
      reason: b.reason,
      start_date: b.start_date,
      end_date: b.end_date,
    }));

    // ── Tomorrow's departures (for "מחר" questions) ──────────────────────────
    const tomorrowDepartures = [];
    for (const g of groups) {
      if (g.group_type === 'DAY_USE') continue;
      const gPeriods = periods.filter(p => p.group_id === g.id);
      const isDeparting = gPeriods.some(p => p.end_date === tomorrow);
      if (isDeparting) {
        tomorrowDepartures.push({
          id: g.id,
          name: g.group_name,
          departure_time: g.departure_time,
          is_mechina: mechinaGroupIds.has(g.id),
        });
      }
    }

    return Response.json({
      operational_date: date,
      operational_time: getJerusalemTime(),
      timezone: 'Asia/Jerusalem',
      from_time: fromTime,
      tomorrow,
      summary: {
        groups_present: present.length,
        arrivals: arrivals.length,
        departures: departures.length,
        day_use: dayUse.length,
        coffee_corners: coffeeData.length,
        open_maintenance: maintenanceOpen.length,
        spaces_for_preparation: spacesForPrep.length,
        sleeping_missing_allocation: sleepingGroupsMissingAllocation.length,
      },
      present,
      arrivals,
      departures,
      day_use: dayUse,
      tomorrow_departures: tomorrowDepartures,
      coffee_corners: coffeeData,
      maintenance_open: maintenanceOpen,
      spaces_for_preparation: spacesForPrep,
      space_blocks: blocksForDate,
      sleeping_missing_allocation: sleepingGroupsMissingAllocation,
      reminders: [
        'לא לשכוח לבדוק / להזין שעות עובדות המשק',
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}