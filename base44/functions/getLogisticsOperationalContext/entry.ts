import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isArrivalDate, isDepartureDate, occupiesSleepingNight, isDateInsideStayPeriods } from '../../shared/groupStayPeriods.js';
import { isGroupOperationallyEnabled } from '../../shared/groupOperationalIsolation.js';
import { profileOperationalInfo, mapAllocation, mapSpaceRequest, mapMaintenance, mapBrief } from '../../shared/logisticsAssistantData.js';

// Private assistant — exact authenticated email is the authority.
const LOGISTICS_MANAGER_EMAIL = 'hospitality@glow-glamping.com';
const EXCLUDED_STATUS = new Set(['CANCELLED', 'ARCHIVED']);

function jerusalemNow() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return { date, time };
}

function nextDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Presence semantics mirror the app's existing groupDateReaders (MULTI_PERIOD via GroupStayPeriod).
function classify(group, date, periods) {
  if (group.stay_mode === 'MULTI_PERIOD') {
    const arrivalPeriod = periods.find(p => p.start_date === date) || null;
    const departurePeriod = periods.find(p => p.end_date === date) || null;
    return {
      is_arrival: isArrivalDate(date, periods),
      is_departure: isDepartureDate(date, periods),
      is_on_site: isDateInsideStayPeriods(date, periods),
      sleeps_tonight: group.group_type === 'LODGING' && occupiesSleepingNight(date, periods),
      // Times come ONLY from the exact matching GroupStayPeriod — never from Group.
      arrival_time: arrivalPeriod ? (arrivalPeriod.arrival_time || null) : null,
      departure_time: departurePeriod ? (departurePeriod.departure_time || null) : null,
    };
  }
  const arrival = group.arrival_date;
  const departure = group.departure_date?.trim() || null;
  if (group.group_type === 'DAY_USE') {
    const today = arrival === date;
    return { is_arrival: today, is_departure: today, is_on_site: today, sleeps_tonight: false,
      arrival_time: today ? (group.arrival_time || null) : null, departure_time: today ? (group.departure_time || null) : null };
  }
  const isArr = arrival === date;
  const isDep = departure === date;
  return {
    is_arrival: isArr,
    is_departure: isDep,
    is_on_site: !!arrival && (isArr || isDep || (!!departure && arrival <= date && departure > date)),
    sleeps_tonight: group.group_type === 'LODGING' && !!departure && arrival <= date && departure > date,
    arrival_time: isArr ? (group.arrival_time || null) : null,
    departure_time: isDep ? (group.departure_time || null) : null,
  };
}

const timeState = (start, end, fromTime) => {
  if (!fromTime) return null;
  if (end && end < fromTime) return 'PASSED';
  if (start && start < fromTime) return end ? 'IN_PROGRESS' : 'PASSED';
  return 'UPCOMING';
};

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (String(user.email || '').trim().toLowerCase() !== LOGISTICS_MANAGER_EMAIL) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const now = jerusalemNow();
    const date = body.date || now.date;
    const fromTime = body.from_time || null;
    const includeReminders = body.include_reminders !== false;

    const db = base44.asServiceRole.entities;

    // Meeting summaries — secondary planning context.
    // Bounded: latest 8 SAVED summaries on/before the requested date, most recent first.
    const [briefs, neighborhoods, standaloneRes, standaloneAssign, spaceRequests] = await Promise.all([
      db.DailyStaffBrief.filter({ date }),
      db.Neighborhood.list(),
      db.StandaloneActivityReservation.filter({ event_date: date, status: 'ACTIVE' }),
      db.StandaloneActivitySpaceAssignment.list('-created_date', 500),
      db.CommonSpaceBookingRequest.filter({ date, status: { $in: ['PENDING', 'APPROVED', 'CHANGE_REQUESTED', 'CANCELLATION_REQUESTED'] } }),
    ]);
    const [allGroups, mechinaAssignments, allPeriods, confirmedAllocs, coffeeAll, maintIssues, scheduleItems, spaces, spaceBlocks, tents, meetingSummariesRaw] = await Promise.all([
      db.Group.list('-created_date', 1000),
      db.MechinaGroupAssignment.filter({ is_active: true }),
      db.GroupStayPeriod.filter({ status: 'ACTIVE' }),
      db.SleepingAllocation.filter({ status: 'CONFIRMED' }),
      db.CoffeeCornerRequest.filter({ date, status: 'ACTIVE' }),
      db.MaintenanceIssue.filter({ status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'] } }),
      db.GroupScheduleItem.filter({ date, status: 'ACTIVE' }),
      db.ActivitySpace.list(),
      db.ActivitySpaceBlock.filter({ status: 'ACTIVE' }),
      db.Tent.list(),
      db.MeetingSummary.filter({ status: 'SAVED' }),
    ]);

    const meeting_summaries = (meetingSummariesRaw || [])
      .filter(m => m.meeting_date && m.meeting_date <= date)
      .sort((a, b) => (b.meeting_date || '').localeCompare(a.meeting_date || ''))
      .slice(0, 8)
      .map(m => ({
        id: m.id,
        meeting_date: m.meeting_date,
        title: m.title,
        relevant_week_start: m.relevant_week_start || null,
        content: m.meeting_summary_text || null,
        topics_tags: m.topics_tags || null,
        mentioned_groups_text: m.mentioned_groups_text || null,
        mentioned_locations_text: m.mentioned_locations_text || null,
        related_group_ids: m.related_group_ids || null,
        created_by: m.created_by || null,
      }));

    const groups = (allGroups || []).filter(g => !EXCLUDED_STATUS.has(g.status) && isGroupOperationallyEnabled(g));
    const groupMap = Object.fromEntries(groups.map(g => [g.id, g]));
    const mechinaIds = new Set((mechinaAssignments || []).map(a => a.group_id));
    const periodsByGroup = {};
    for (const p of allPeriods || []) (periodsByGroup[p.group_id] ||= []).push(p);
    const spaceMap = Object.fromEntries((spaces || []).map(s => [s.id, s]));
    const tentMap = Object.fromEntries((tents || []).map(t => [t.id, t]));

    // Valid allocation = CONFIRMED row covering the specific night (arrival_date <= night < departure_date).
    const allocsCoveringNight = (groupId) => (confirmedAllocs || []).filter(a =>
      a.group_id === groupId && a.arrival_date <= date && date < a.departure_date);

    const nbMap = Object.fromEntries((neighborhoods || []).map(n => [n.id, n]));
    const presentGroups = groups.filter(g => {
      const c = classify(g, date, periodsByGroup[g.id] || []);
      return c.is_on_site || c.is_arrival || c.is_departure;
    });
    const profiles = presentGroups.length
      ? await db.OperationalGroupProfile.filter({ group_id: { $in: presentGroups.map(g => g.id) } })
      : [];
    const profileByGroup = Object.fromEntries((profiles || []).map(p => [p.group_id, p]));

    const groupsOut = [];
    for (const g of presentGroups) {
      const c = classify(g, date, periodsByGroup[g.id] || []);
      const nightAllocs = c.sleeps_tonight ? allocsCoveringNight(g.id) : [];
      const periodToday = (periodsByGroup[g.id] || []).find(p => p.start_date <= date && date <= p.end_date);
      groupsOut.push({
        status: g.status,
        contact_name: g.contact_name || null,
        contact_phone: g.contact_phone || null,
        group_internal_notes: g.internal_notes || null,
        stay_period_notes: periodToday?.notes || null,
        profile: profileOperationalInfo(profileByGroup[g.id]),
        sleeping_tonight: nightAllocs.map(a => mapAllocation(a, tentMap, nbMap)),
        id: g.id,
        name: g.group_name,
        group_type: g.group_type,
        stay_mode: g.stay_mode || 'CONTINUOUS',
        is_mechina: mechinaIds.has(g.id),
        total_pax: g.total_pax,
        staff_count: g.staff_count,
        participant_count: g.participant_count,
        ...c,
        sleeping_tents_tonight: nightAllocs.map(a => tentMap[a.tent_id]?.code || a.tent_id),
      });
    }

    const byTime = (key) => (a, b) => (a[key] || '99:99').localeCompare(b[key] || '99:99');
    const arrivals = groupsOut.filter(g => g.is_arrival && g.group_type !== 'DAY_USE').sort(byTime('arrival_time'));
    const departures = groupsOut.filter(g => g.is_departure && g.group_type !== 'DAY_USE').sort(byTime('departure_time'));
    const dayUse = groupsOut.filter(g => g.group_type === 'DAY_USE');
    const sleepingMissing = groupsOut
      .filter(g => g.sleeps_tonight && g.sleeping_tents_tonight.length === 0)
      .map(g => ({ id: g.id, name: g.name, night: date, is_arrival: g.is_arrival, is_mechina: g.is_mechina }));

    // Coffee — scheduled data only; no readiness field exists, never claim ready.
    const coffee = (coffeeAll || []).filter(c => groupMap[c.group_id])
      .filter(c => !fromTime || !c.start_time || c.start_time >= fromTime)
      .map(c => ({
        id: c.id,
        group_name: groupMap[c.group_id].group_name,
        start_time: c.start_time,
        end_time: c.end_time,
        pax: c.pax,
        type: c.coffee_corner_type,
        location: c.location_name_snapshot,
        notes: c.notes,
        is_mechina: mechinaIds.has(c.group_id),
      })).sort(byTime('start_time'));

    const activities = (scheduleItems || []).filter(s => groupMap[s.group_id]).map(s => ({
      id: s.id,
      group_name: groupMap[s.group_id].group_name,
      is_mechina: mechinaIds.has(s.group_id),
      activity_name: s.activity_name,
      start_time: s.start_time,
      end_time: s.end_time,
      time_state: timeState(s.start_time, s.end_time, fromTime),
      space_name: s.activity_space_id ? (spaceMap[s.activity_space_id]?.name || s.activity_space_code || null) : null,
      requested_location: s.requested_location,
      pax: s.pax,
      needs: ['projector', 'screen', 'microphone', 'sound', 'whiteboard', 'chair_circle'].filter(k => s[`needs_${k}`]),
      chairs_count: s.chairs_count,
      logistics_other: s.logistics_other,
      notes: s.notes || null,
      is_shared_activity: !!s.is_shared_activity,
    })).sort(byTime('start_time'));

    const assignByRes = {};
    for (const a of standaloneAssign || []) (assignByRes[a.reservation_id] ||= []).push(a);
    const standalone_activities = (standaloneRes || []).map(r => ({
      title: r.title,
      activity_type: r.activity_type,
      start_time: r.start_time,
      end_time: r.end_time,
      expected_pax: r.expected_pax ?? null,
      organizer_name: r.organizer_name || null,
      spaces: (assignByRes[r.id] || []).map(a => ({
        space_name: spaceMap[a.activity_space_id]?.name || null,
        needs: ['projector', 'screen', 'microphone', 'sound', 'whiteboard', 'chair_circle'].filter(k => a[`needs_${k}`]),
        chairs_count: a.chairs_count ?? null,
        setup_layout: a.setup_layout || null,
        logistics_other: a.logistics_other || null,
        notes: a.notes || null,
      })),
      general_notes: r.general_notes || null,
      preparation_notes: r.preparation_notes || null,
      during_activity_notes: r.during_activity_notes || null,
      cleanup_notes: r.cleanup_notes || null,
    })).sort(byTime('start_time'));

    const common_space_requests = (spaceRequests || [])
      .filter(r => groupMap[r.mechina_group_id])
      .map(r => ({ ...mapSpaceRequest(r), group_name: groupMap[r.mechina_group_id].group_name }))
      .sort(byTime('start_time'));

    // Default prep checklist excludes Mechina; Mechina activities remain available separately.
    const spacesForPrep = activities.filter(a => a.space_name && !a.is_mechina);
    const mechinaActivities = activities.filter(a => a.is_mechina);

    // Maintenance — relevance only via EXACT name match to a space or tent used on this date.
    const usedNames = new Set([
      ...activities.map(a => a.space_name).filter(Boolean),
      ...coffee.map(c => c.location).filter(Boolean),
      ...groupsOut.flatMap(g => g.sleeping_tents_tonight),
    ]);
    const maintenance = (maintIssues || []).map(m => ({
      ...mapMaintenance(m),
      location_in_use_on_date: !!m.location_name && usedNames.has(m.location_name),
    }));

    const blocks = (spaceBlocks || []).filter(b => b.start_date <= date && (!b.end_date || date <= b.end_date)).map(b => ({
      space_name: spaceMap[b.activity_space_id]?.name || b.activity_space_name,
      reason_type: b.reason_type,
      reason_notes: b.reason_notes,
      start_date: b.start_date,
      end_date: b.end_date,
    }));

    return Response.json({
      requested_date: date,
      is_today: date === now.date,
      current_date: now.date,
      current_time: now.time,
      tomorrow_of_requested: nextDate(date),
      timezone: 'Asia/Jerusalem',
      from_time: fromTime,
      summary: {
        groups_on_site: groupsOut.length,
        arrivals: arrivals.length,
        departures: departures.length,
        day_use: dayUse.length,
        coffee_corners: coffee.length,
        open_maintenance: maintenance.length,
        spaces_for_preparation: spacesForPrep.length,
        sleeping_missing_allocation: sleepingMissing.length,
      },
      groups: groupsOut,
      arrivals,
      departures,
      day_use: dayUse,
      coffee_corners: coffee,
      activities,
      spaces_for_preparation: spacesForPrep,
      mechina_activities: mechinaActivities,
      space_blocks: blocks,
      standalone_activities,
      common_space_requests,
      daily_staff_brief: mapBrief((briefs || []).find(b => b.status !== 'ARCHIVED')),
      maintenance_open: maintenance,
      sleeping_missing_allocation: sleepingMissing,
      meeting_summaries,
      reminders: includeReminders ? ['תזכורת כללית: לבדוק / להזין שעות עובדות המשק (תזכורת בלבד — אין נתון שמוכיח שחסר)'] : [],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}