import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { todayIL, readAll } from '../../shared/stayReconciliationCore.js';
import { isDateInsideStayPeriods } from '../../shared/groupStayPeriods.js';

// READ-ONLY. Previews what cancelling an approved Quote booking would affect. Never writes.
const ALLOWED_ROLES = new Set(['QUOTES_MANAGER', 'ADMIN', 'SUPER_ADMIN']);
const CLOSED_GROUP_STATUSES = new Set(['CANCELLED', 'COMPLETED', 'ARCHIVED']);
const LIST_CAP = 200;

// Classification: PAST (preserve) | FUTURE (would be cancelled/released) | IN_PROGRESS / TODAY (admin review) | ALREADY_INACTIVE
const classifyRange = (start, endExclusive, today) => {
  if (!start || !endExclusive) return 'REVIEW_INVALID_DATES';
  if (endExclusive <= today) return 'PAST';
  if (start > today) return 'FUTURE';
  if (start === today) return 'TODAY';
  return 'IN_PROGRESS';
};
const classifyDate = (date, today) => !date ? 'REVIEW_INVALID_DATES' : date < today ? 'PAST' : date > today ? 'FUTURE' : 'TODAY';

function summarize(rows, isActive, classify, project) {
  const buckets = { FUTURE: [], TODAY: [], IN_PROGRESS: [], PAST: [], ALREADY_INACTIVE: [], REVIEW_INVALID_DATES: [] };
  for (const row of rows) {
    const key = isActive(row) ? classify(row) : 'ALREADY_INACTIVE';
    buckets[key].push(project(row));
  }
  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k.toLowerCase(), v.length]));
  const cap = list => list.slice(0, LIST_CAP);
  return {
    counts,
    would_cancel: cap(buckets.FUTURE),
    requires_review: cap([...buckets.TODAY.map(r => ({ ...r, reason: 'TODAY' })), ...buckets.IN_PROGRESS.map(r => ({ ...r, reason: 'IN_PROGRESS' })), ...buckets.REVIEW_INVALID_DATES.map(r => ({ ...r, reason: 'INVALID_DATES' }))]),
    preserved_history_count: buckets.PAST.length,
    truncated: Object.values(buckets).some(list => list.length > LIST_CAP),
  };
}

async function resolveCaller(base44, user) {
  const email = String(user.email || '').trim().toLowerCase();
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await base44.asServiceRole.entities.InternalUser.filter({ email: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } }, '-updated_date', 10);
  const internal = rows.find(r => r.active !== false);
  return internal && ALLOWED_ROLES.has(internal.role) ? internal : null;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const caller = await resolveCaller(base44, user);
    if (!caller) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const quoteId = typeof body.quote_id === 'string' ? body.quote_id.trim() : '';
    if (!quoteId) return Response.json({ success: false, error: 'QUOTE_ID_REQUIRED' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    const quote = await db.Quote.get(quoteId).catch(() => null);
    if (!quote) return Response.json({ success: false, error: 'QUOTE_NOT_FOUND' }, { status: 404 });

    const blockers = [];
    const warnings = [];
    if (quote.status !== 'APPROVED') blockers.push('QUOTE_NOT_APPROVED');
    if (!quote.group_id) blockers.push('QUOTE_HAS_NO_GROUP');
    const group = quote.group_id ? (await db.Group.filter({ id: quote.group_id }))[0] || null : null;
    if (quote.group_id && !group) blockers.push('LINKED_GROUP_NOT_FOUND');

    // Never reveal anything about a Group that is not validly linked to this Quote.
    if (!group || blockers.length) {
      return Response.json({ success: true, eligible: false, blockers, quote: { id: quote.id, status: quote.status, group_id: quote.group_id || null } });
    }

    if (group.status === 'CANCELLED') blockers.push('GROUP_ALREADY_CANCELLED');
    else if (CLOSED_GROUP_STATUSES.has(group.status)) blockers.push(`GROUP_STATUS_${group.status}`);
    const approvedForGroup = await db.Quote.filter({ group_id: group.id, status: 'APPROVED' });
    if (approvedForGroup.length > 1) blockers.push('MULTIPLE_APPROVED_QUOTES_FOR_GROUP');

    const today = todayIL();
    const gid = group.id;
    const [periods, allocations, neighborhoods, meals, schedule, coffee, prisa, holds, mechina] = await Promise.all([
      readAll(db.GroupStayPeriod, { group_id: gid }),
      readAll(db.SleepingAllocation, { group_id: gid }),
      readAll(db.NeighborhoodReservation, { group_id: gid }),
      readAll(db.MealReservation, { group_id: gid }),
      readAll(db.GroupScheduleItem, { group_id: gid }),
      readAll(db.CoffeeCornerRequest, { group_id: gid }),
      readAll(db.PrisaRequest, { group_id: gid }),
      readAll(db.OperationalHold, { group_id: gid }),
      readAll(db.CommonSpaceBookingRequest, { mechina_group_id: gid }),
    ]);

    const isMulti = group.stay_mode === 'MULTI_PERIOD';
    const activePeriods = periods.filter(p => p.status === 'ACTIVE');
    // Presence reuses existing semantics: MULTI_PERIOD via GroupStayPeriod; otherwise Group dates (departure inclusive as a presence day).
    const onSiteToday = isMulti
      ? isDateInsideStayPeriods(today, activePeriods)
      : !!group.arrival_date && group.arrival_date <= today && today <= (group.departure_date || group.arrival_date);
    const stayStarted = isMulti ? activePeriods.some(p => p.start_date <= today) : !!group.arrival_date && group.arrival_date <= today;
    if (onSiteToday) blockers.push('GROUP_ON_SITE_TODAY');
    else if (stayStarted) warnings.push('STAY_ALREADY_STARTED_HISTORY_PRESERVED');
    if (isMulti && activePeriods.length === 0) warnings.push('MULTI_PERIOD_WITHOUT_ACTIVE_PERIODS');

    const isActiveStatus = r => r.status === 'ACTIVE';
    const resources = {
      // Period end_date is the checkout day (inclusive presence) → exclusive end = day after for classification.
      stay_periods: summarize(periods, isActiveStatus, p => p.end_date < today ? 'PAST' : p.start_date > today ? 'FUTURE' : p.start_date === today ? 'TODAY' : 'IN_PROGRESS',
        p => ({ id: p.id, start_date: p.start_date, end_date: p.end_date })),
      sleeping_allocations: summarize(allocations, r => ['DRAFT', 'CONFIRMED'].includes(r.status), r => classifyRange(r.arrival_date, r.departure_date, today),
        r => ({ id: r.id, tent_id: r.tent_id, arrival_date: r.arrival_date, departure_date: r.departure_date, status: r.status, allocated_pax: r.allocated_pax, stay_period_id: r.stay_period_id || null })),
      neighborhood_reservations: summarize(neighborhoods, isActiveStatus, r => classifyRange(r.arrival_date, r.departure_date, today),
        r => ({ id: r.id, neighborhood_id: r.neighborhood_id, arrival_date: r.arrival_date, departure_date: r.departure_date, stay_period_id: r.stay_period_id || null })),
      meal_reservations: summarize(meals, isActiveStatus, r => classifyDate(r.date, today), r => ({ id: r.id, date: r.date, meal_type: r.meal_type, pax: r.pax })),
      schedule_items: summarize(schedule, isActiveStatus, r => classifyDate(r.date, today),
        r => ({ id: r.id, date: r.date, start_time: r.start_time, activity_name: r.activity_name, activity_space_id: r.activity_space_id || null, is_shared_activity: r.is_shared_activity === true })),
      coffee_requests: summarize(coffee, isActiveStatus, r => classifyDate(r.date, today), r => ({ id: r.id, date: r.date, start_time: r.start_time, pax: r.pax })),
      prisa_requests: summarize(prisa, isActiveStatus, r => classifyDate(r.date, today), r => ({ id: r.id, date: r.date, pickup_slot: r.pickup_slot, effective_quantity: r.effective_quantity })),
      operational_holds: summarize(holds, isActiveStatus, r => !r.arrival_date ? 'REVIEW_INVALID_DATES' : r.arrival_date > today ? 'FUTURE' : (r.departure_date || r.arrival_date) < today ? 'PAST' : 'IN_PROGRESS',
        r => ({ id: r.id, arrival_date: r.arrival_date, departure_date: r.departure_date || null, total_pax: r.total_pax })),
      mechina_space_requests: summarize(mechina, r => ['PENDING', 'APPROVED', 'CHANGE_REQUESTED', 'CANCELLATION_REQUESTED'].includes(r.status), r => classifyDate(r.date, today),
        r => ({ id: r.id, date: r.date, status: r.status, space_name: r.space_name, approved_schedule_item_id: r.approved_schedule_item_id || null })),
    };

    // Shared activities involve other Groups — never cancelled implicitly.
    const sharedFuture = resources.schedule_items.would_cancel.filter(i => i.is_shared_activity);
    if (sharedFuture.length) warnings.push('FUTURE_SHARED_ACTIVITIES_REQUIRE_REVIEW');

    // Google Calendar mirrors only for future schedule items that would be cancelled.
    const futureItemIds = schedule.filter(i => i.status === 'ACTIVE' && i.date > today).map(i => i.id);
    const syncs = [];
    for (let i = 0; i < futureItemIds.length; i += 100) {
      syncs.push(...await db.CalendarSync.filter({ group_schedule_item_id: { $in: futureItemIds.slice(i, i + 100) } }));
    }

    const reviewCount = Object.values(resources).reduce((s, r) => s + r.requires_review.length, 0);
    if (reviewCount) warnings.push('RECORDS_REQUIRE_ADMIN_REVIEW');
    if (Object.values(resources).some(r => r.truncated)) warnings.push('LISTS_TRUNCATED');

    return Response.json({
      success: true,
      read_only: true,
      eligible: blockers.length === 0,
      requires_admin_review: blockers.includes('GROUP_ON_SITE_TODAY') || reviewCount > 0 || sharedFuture.length > 0,
      today,
      timezone: 'Asia/Jerusalem',
      caller_role: caller.role,
      blockers,
      warnings,
      quote: { id: quote.id, status: quote.status, quote_number: quote.quote_number || null, client_name: quote.client_name || null, approved_option_key: quote.approved_option_key || null, will_change: false },
      group: { id: group.id, group_name: group.group_name, status: group.status, stay_mode: group.stay_mode || 'CONTINUOUS', group_type: group.group_type, arrival_date: group.arrival_date, departure_date: group.departure_date || null },
      intended_effects: {
        group_status: { from: group.status, to: 'CANCELLED' },
        quote_status_unchanged: true,
        remove_future_operational_presence: true,
        release_future_capacity: true,
        preserve_history: true,
      },
      resources,
      calendar: { future_synced_events: syncs.length, calendar_sync_ids: syncs.slice(0, LIST_CAP).map(s => s.id) },
      shared_activities_requiring_review: sharedFuture,
    });
  } catch (error) {
    console.error('[previewQuoteBookingCancellation]', error?.message);
    return Response.json({ success: false, error: 'PREVIEW_FAILED' }, { status: 500 });
  }
}