import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { todayIL } from '../../shared/stayReconciliationCore.js';
import { isValidDateString } from '../../shared/groupStayPeriods.js';

// READ-ONLY (B1.1). Previews what cancelling an approved Quote booking would affect. Never writes.
// Execution model: caller identity comes from the request token (auth.me); authorization is the
// InternalUser whitelist; reads use service role only after authorization succeeds.
const ALLOWED_ROLES = new Set(['QUOTES_MANAGER', 'SUPER_ADMIN']);
// B2 release gate: commit stays disabled until non-production checks prove serialization/recovery.
const B2_COMMIT_ENABLED = false;
const GROUP_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'ARCHIVED']);
const CLOSED_GROUP_STATUSES = new Set(['CANCELLED', 'COMPLETED', 'ARCHIVED']);
const LIST_CAP = 200;
const PAGE = 500;
const CHUNK = 100;

// Supported status enums per resource, taken from the entity schemas.
const AC = { known: ['ACTIVE', 'CANCELLED'], active: ['ACTIVE'] };
const STATUS = {
  stay_periods: AC,
  sleeping_allocations: { known: ['DRAFT', 'CONFIRMED', 'CANCELLED'], active: ['DRAFT', 'CONFIRMED'] },
  neighborhood_reservations: AC,
  meal_reservations: AC,
  schedule_items: AC,
  coffee_requests: AC,
  prisa_requests: AC,
  operational_holds: { known: ['ACTIVE', 'RELEASED', 'CANCELLED'], active: ['ACTIVE'] },
  mechina_space_requests: { known: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CHANGE_REQUESTED', 'CANCELLATION_REQUESTED'], active: ['PENDING', 'APPROVED', 'CHANGE_REQUESTED', 'CANCELLATION_REQUESTED'] },
};

class PreviewError extends Error { constructor(code) { super(code); this.code = code; } }

// Offset pagination sorted by id; a repeated id means the set shifted during the scan → incomplete read.
async function readAllStrict(entity, query) {
  const rows = []; const seen = new Set();
  for (let skip = 0; ; skip += PAGE) {
    const page = await entity.filter(query, 'id', PAGE, skip);
    if (!Array.isArray(page)) throw new PreviewError('READ_FAILED');
    for (const row of page) { if (seen.has(row.id)) throw new PreviewError('READ_INCONSISTENT'); seen.add(row.id); rows.push(row); }
    if (page.length < PAGE) return rows;
  }
}
async function readByIds(entity, field, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...await readAllStrict(entity, { [field]: { $in: ids.slice(i, i + CHUNK) } }));
  return out;
}

// Date classification — all boundaries compared as Asia/Jerusalem YYYY-MM-DD strings.
const single = date => today => !isValidDateString(date) ? 'INVALID_DATES' : date < today ? 'PAST' : date > today ? 'FUTURE' : 'TODAY';
const exclusive = (start, endEx) => today => {
  if (!isValidDateString(start) || !isValidDateString(endEx) || start >= endEx) return 'INVALID_DATES';
  if (endEx <= today) return 'PAST'; if (start > today) return 'FUTURE'; return start === today ? 'TODAY' : 'IN_PROGRESS';
};
const inclusive = (start, end) => today => {
  if (!isValidDateString(start) || !isValidDateString(end) || end < start) return 'INVALID_DATES';
  if (end < today) return 'PAST'; if (start > today) return 'FUTURE'; return start === today ? 'TODAY' : 'IN_PROGRESS';
};

function summarize(name, rows, today, classifier, project) {
  const { known, active } = STATUS[name];
  const b = { FUTURE: [], TODAY: [], IN_PROGRESS: [], PAST: [], ALREADY_INACTIVE: [], INVALID_DATES: [], UNKNOWN_STATUS: [] };
  for (const row of rows) {
    const key = !known.includes(row.status) ? 'UNKNOWN_STATUS' : !active.includes(row.status) ? 'ALREADY_INACTIVE' : classifier(row)(today);
    b[key].push({ ...project(row), status: row.status ?? null, classification: key });
  }
  const blocked = [...b.TODAY, ...b.IN_PROGRESS, ...b.INVALID_DATES, ...b.UNKNOWN_STATUS];
  return {
    counts: Object.fromEntries(Object.entries(b).map(([k, v]) => [k.toLowerCase(), v.length])),
    would_cancel: b.FUTURE.slice(0, LIST_CAP),
    blocked_records: blocked.slice(0, LIST_CAP),
    preserved_history_count: b.PAST.length,
    truncated: b.FUTURE.length > LIST_CAP || blocked.length > LIST_CAP,
    _future: b.FUTURE,
  };
}

async function resolveCaller(db, user) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return { error: 'FORBIDDEN', status: 403 };
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await db.InternalUser.filter({ email: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } }, '-updated_date', 50);
  if (rows.length >= 50) return { error: 'AMBIGUOUS_INTERNAL_USER', status: 409 };
  const active = rows.filter(r => String(r.email || '').trim().toLowerCase() === email && r.active !== false);
  if (!active.length) return { error: 'FORBIDDEN', status: 403 };
  if (new Set(active.map(r => r.role)).size > 1) return { error: 'AMBIGUOUS_INTERNAL_USER', status: 409 };
  if (!ALLOWED_ROLES.has(active[0].role)) return { error: 'FORBIDDEN', status: 403 };
  return { caller: active[0] };
}

const canonical = v => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : (v ?? null);
async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
const FP_KEYS = ['id', 'status', 'updated_date', 'group_id', 'date', 'start_date', 'end_date', 'arrival_date', 'departure_date', 'tent_id', 'neighborhood_id', 'stay_period_id', 'allocation_series_id', 'allocated_pax', 'pax', 'quote_id', 'shared_activity_id', 'is_shared_activity', 'approved_schedule_item_id', 'activity_space_id', 'mechina_group_id'];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const db = base44.asServiceRole.entities;
    const auth = await resolveCaller(db, user);
    if (auth.error) return Response.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const quoteId = typeof body.quote_id === 'string' ? body.quote_id.trim() : '';
    if (!quoteId) return Response.json({ success: false, error: 'QUOTE_ID_REQUIRED' }, { status: 400 });

    const quote = (await db.Quote.filter({ id: quoteId }))[0] || null;
    if (!quote) return Response.json({ success: false, error: 'QUOTE_NOT_FOUND' }, { status: 404 });

    const blockers = []; const warnings = [];
    const baseBlockers = quote.status !== 'APPROVED' ? ['QUOTE_NOT_APPROVED'] : [];
    blockers.push(...baseBlockers);
    // Operational records that point at this Quote directly (independent of Quote.group_id).
    const [quoteHolds, quoteProfiles] = await Promise.all([
      readAllStrict(db.OperationalHold, { quote_id: quote.id }),
      readAllStrict(db.OperationalGroupProfile, { quote_id: quote.id }),
    ]);
    const group = quote.group_id ? (await db.Group.filter({ id: quote.group_id }))[0] || null : null;

    if (!group) {
      // No usable Group: booking cancellation impossible; Quote-only withdrawal possible only if nothing references the Quote.
      const mistake = [...baseBlockers];
      if (quote.group_id) mistake.push('LINKED_GROUP_NOT_FOUND');
      if (quoteHolds.some(h => h.status === 'ACTIVE') || quoteProfiles.length) mistake.push('QUOTE_REFERENCED_BY_OPERATIONAL_RECORDS');
      const fingerprint = await sha256({ v: 'B2.1', quote: pick(quote, ['id', 'status', 'group_id', 'updated_date']), holds: quoteHolds.sort(byId).map(r => pick(r, FP_KEYS)), profiles: quoteProfiles.sort(byId).map(r => pick(r, FP_KEYS)) });
      return Response.json({
        success: true, read_only: true, commit_enabled: B2_COMMIT_ENABLED, fingerprint, eligible: false,
        blockers: [...baseBlockers, quote.group_id ? 'LINKED_GROUP_NOT_FOUND' : 'QUOTE_HAS_NO_GROUP'],
        reasons: {
          CUSTOMER_CANCELLED: { eligible: false, blockers: [...baseBlockers, quote.group_id ? 'LINKED_GROUP_NOT_FOUND' : 'QUOTE_HAS_NO_GROUP'], requires_no_arrival_declaration: false },
          CREATED_BY_MISTAKE: { eligible: mistake.length === 0, blockers: mistake, effect: 'QUOTE_ONLY_WITHDRAWAL' },
        },
        quote: { id: quote.id, status: quote.status, group_id: quote.group_id || null },
      });
    }

    if (!GROUP_STATUSES.has(group.status)) blockers.push('UNKNOWN_GROUP_STATUS');
    else if (group.status === 'CANCELLED') blockers.push('GROUP_ALREADY_CANCELLED');
    else if (CLOSED_GROUP_STATUSES.has(group.status)) blockers.push(`GROUP_STATUS_${group.status}`);

    const today = todayIL();
    const gid = group.id;
    const [approvedForGroup, profiles, periods, allocations, neighborhoods, meals, schedule, coffee, prisa, holds, mechina] = await Promise.all([
      readAllStrict(db.Quote, { group_id: gid, status: 'APPROVED' }),
      readAllStrict(db.OperationalGroupProfile, { group_id: gid }),
      readAllStrict(db.GroupStayPeriod, { group_id: gid }),
      readAllStrict(db.SleepingAllocation, { group_id: gid }),
      readAllStrict(db.NeighborhoodReservation, { group_id: gid }),
      readAllStrict(db.MealReservation, { group_id: gid }),
      readAllStrict(db.GroupScheduleItem, { group_id: gid }),
      readAllStrict(db.CoffeeCornerRequest, { group_id: gid }),
      readAllStrict(db.PrisaRequest, { group_id: gid }),
      readAllStrict(db.OperationalHold, { group_id: gid }),
      readAllStrict(db.CommonSpaceBookingRequest, { mechina_group_id: gid }),
    ]);

    // Quote ↔ Group relationship (Quote.group_id is canonical).
    const approvedQuoteIds = approvedForGroup.map(q => q.id).sort();
    if (approvedQuoteIds.length > 1) blockers.push('MULTIPLE_APPROVED_QUOTES_FOR_GROUP');
    if (!approvedQuoteIds.includes(quote.id)) blockers.push('QUOTE_GROUP_RELATIONSHIP_INVALID');

    // Quote references on holds/profiles: orphaned (deleted Quote) vs. linked to another existing Quote.
    const refs = [
      ...holds.map(h => ({ kind: 'OperationalHold', id: h.id, quote_id: h.quote_id || null, active: h.status === 'ACTIVE' })),
      ...profiles.map(p => ({ kind: 'OperationalGroupProfile', id: p.id, quote_id: p.quote_id || null, active: true })),
    ].filter(r => r.quote_id && r.quote_id !== quote.id);
    const refIds = [...new Set(refs.map(r => r.quote_id))].sort();
    const existingRefIds = new Set((await readByIds(db.Quote, 'id', refIds)).map(q => q.id));
    const orphaned = refs.filter(r => !existingRefIds.has(r.quote_id));
    const otherQuote = refs.filter(r => existingRefIds.has(r.quote_id));
    if (orphaned.some(r => r.active)) blockers.push('ORPHANED_QUOTE_REFERENCE');
    else if (orphaned.length) warnings.push('INACTIVE_ORPHANED_QUOTE_REFERENCE');
    if (otherQuote.some(r => r.active)) blockers.push('RESOURCE_LINKED_TO_OTHER_QUOTE');
    else if (otherQuote.length) warnings.push('INACTIVE_RESOURCE_LINKED_TO_OTHER_QUOTE');
    if (profiles.length > 1) blockers.push('MULTIPLE_OPERATIONAL_PROFILES');

    // Presence (initial scope blocks any on-site or started stay).
    const isMulti = group.stay_mode === 'MULTI_PERIOD';
    if (isMulti) blockers.push('MULTI_PERIOD_NOT_SUPPORTED_IN_INITIAL_SCOPE');
    else if (!isValidDateString(group.arrival_date) || (group.departure_date && !isValidDateString(group.departure_date)) || (group.departure_date && group.departure_date < group.arrival_date)) blockers.push('GROUP_DATES_INVALID');
    // Planned dates are never proof of arrival. Today/past planned arrival only requires an explicit audited no-arrival declaration.
    const requiresNoArrivalDeclaration = isValidDateString(group.arrival_date) && group.arrival_date <= today;

    // No physical check-in system exists; none is assumed. None of these records is proof of arrival:
    // - PostStayReport SENT: sent to the client after a stay → strongest available signal (blocks for review).
    // - PostStayIncident: manual, may be created/cancelled at any time; only non-cancelled incidents dated today or earlier count.
    // - MechinaSleepingReportVersion SUBMITTED: a roster that can be submitted before arrival → possible signal only.
    const [incidents, postReports, sleepReports] = await Promise.all([
      readAllStrict(db.PostStayIncident, { group_id: gid }),
      readAllStrict(db.PostStayReport, { group_id: gid }),
      readAllStrict(db.MechinaSleepingReportVersion, { group_id: gid, status: 'SUBMITTED' }),
    ]);
    const stayEvidence = {
      post_stay_reports_sent: postReports.filter(r => r.status === 'SENT').length,
      post_stay_incidents_dated: incidents.filter(i => i.status !== 'CANCELLED' && isValidDateString(i.date) && i.date <= today).length,
    };
    if (Object.values(stayEvidence).some(n => n > 0)) blockers.push('ACTUAL_STAY_EVIDENCE');
    // Possible-stay signals (not proof): recorded for audit, never blockers on their own.
    const possibleStaySignals = [];
    const undatedIncidents = incidents.filter(i => i.status !== 'CANCELLED' && !isValidDateString(i.date)).length;
    if (undatedIncidents) possibleStaySignals.push({ resource: 'post_stay_incidents_undated', count: undatedIncidents });
    const startedRosters = sleepReports.filter(v => isValidDateString(v.period_start) && v.period_start <= today).length;
    if (sleepReports.length) possibleStaySignals.push({ resource: 'submitted_sleeping_reports', count: sleepReports.length, period_started: startedRosters });

    const resources = {
      stay_periods: summarize('stay_periods', periods, today, p => inclusive(p.start_date, p.end_date), p => pick(p, ['id', 'start_date', 'end_date'])),
      sleeping_allocations: summarize('sleeping_allocations', allocations, today, r => exclusive(r.arrival_date, r.departure_date),
        r => pick(r, ['id', 'tent_id', 'arrival_date', 'departure_date', 'allocated_pax', 'stay_period_id'])),
      neighborhood_reservations: summarize('neighborhood_reservations', neighborhoods, today, r => exclusive(r.arrival_date, r.departure_date),
        r => pick(r, ['id', 'neighborhood_id', 'arrival_date', 'departure_date', 'stay_period_id'])),
      meal_reservations: summarize('meal_reservations', meals, today, r => single(r.date), r => pick(r, ['id', 'date', 'meal_type', 'pax'])),
      schedule_items: summarize('schedule_items', schedule, today, r => single(r.date),
        r => ({ ...pick(r, ['id', 'date', 'start_time', 'activity_name', 'activity_space_id', 'shared_activity_id']), is_shared_activity: r.is_shared_activity === true })),
      coffee_requests: summarize('coffee_requests', coffee, today, r => single(r.date), r => pick(r, ['id', 'date', 'start_time', 'pax'])),
      prisa_requests: summarize('prisa_requests', prisa, today, r => single(r.date), r => pick(r, ['id', 'date', 'pickup_slot', 'effective_quantity'])),
      // Holds: arrival_date..departure_date, both inclusive presence days; departure_date is required (no assumption).
      operational_holds: summarize('operational_holds', holds, today, r => inclusive(r.arrival_date, r.departure_date),
        r => ({ ...pick(r, ['id', 'quote_id', 'arrival_date', 'departure_date', 'total_pax']), classified_by: { start: r.arrival_date ?? null, end_inclusive: r.departure_date ?? null, timezone: 'Asia/Jerusalem' } })),
      mechina_space_requests: summarize('mechina_space_requests', mechina, today, r => single(r.date),
        r => pick(r, ['id', 'date', 'space_name', 'approved_schedule_item_id'])),
    };
    for (const [name, r] of Object.entries(resources)) {
      if (r.counts.unknown_status) blockers.push(`UNKNOWN_STATUS:${name}`);
      if (r.counts.invalid_dates) blockers.push(`INVALID_DATES:${name}`);
      if (r.counts.today || r.counts.in_progress || r.preserved_history_count) possibleStaySignals.push({ resource: name, today: r.counts.today, in_progress: r.counts.in_progress, past: r.preserved_history_count });
      if (r.truncated) warnings.push(`LIST_TRUNCATED:${name}`);
    }

    // Shared activities — authoritative linkage via shared_activity_id across GroupScheduleItem.
    const futureItems = schedule.filter(i => i.status === 'ACTIVE' && isValidDateString(i.date) && i.date > today);
    const flaggedNoId = futureItems.filter(i => i.is_shared_activity === true && !i.shared_activity_id);
    if (flaggedNoId.length) blockers.push('SHARED_ACTIVITY_OWNERSHIP_AMBIGUOUS');
    const sharedIds = [...new Set(futureItems.map(i => i.shared_activity_id).filter(Boolean))].sort();
    const sharedRows = await readByIds(db.GroupScheduleItem, 'shared_activity_id', sharedIds);
    const sharedActivities = sharedIds.map(sid => {
      const linked = sharedRows.filter(r => r.shared_activity_id === sid).sort(byId);
      return {
        shared_activity_id: sid,
        own_item_ids: linked.filter(r => r.group_id === gid).map(r => r.id),
        linked_items: linked.filter(r => r.group_id !== gid).map(r => pick(r, ['id', 'group_id', 'date', 'start_time', 'status'])),
        other_group_ids: [...new Set(linked.filter(r => r.group_id !== gid).map(r => r.group_id))].sort(),
      };
    });
    if (sharedActivities.length) blockers.push('FUTURE_SHARED_ACTIVITY');

    // Mechina requests ↔ linked schedule item must belong to this Group.
    const mechinaIssues = [];
    const scheduleById = Object.fromEntries(schedule.map(i => [i.id, i]));
    const activeMechina = mechina.filter(r => STATUS.mechina_space_requests.active.includes(r.status));
    const externalLinkIds = [...new Set(activeMechina.map(r => r.approved_schedule_item_id).filter(id => id && !scheduleById[id]))].sort();
    const externalItems = Object.fromEntries((await readByIds(db.GroupScheduleItem, 'id', externalLinkIds)).map(i => [i.id, i]));
    for (const r of activeMechina) {
      const itemId = r.approved_schedule_item_id;
      if (r.status === 'APPROVED' && !itemId) mechinaIssues.push({ request_id: r.id, issue: 'APPROVED_WITHOUT_SCHEDULE_ITEM' });
      else if (itemId && !scheduleById[itemId]) mechinaIssues.push({ request_id: r.id, schedule_item_id: itemId, issue: externalItems[itemId] ? 'SCHEDULE_ITEM_BELONGS_TO_OTHER_GROUP' : 'SCHEDULE_ITEM_NOT_FOUND', item_group_id: externalItems[itemId]?.group_id || null });
    }
    if (mechinaIssues.length) blockers.push('MECHINA_LINK_MISMATCH');

    // Google Calendar — legacy group_schedule_item_id + current source_type/source_id; includes leftovers for cancelled future items.
    const futureAnyIds = schedule.filter(i => isValidDateString(i.date) && i.date > today).map(i => i.id).sort();
    const [legacySyncs, sourceSyncs] = await Promise.all([
      readByIds(db.CalendarSync, 'group_schedule_item_id', futureAnyIds),
      readByIds(db.CalendarSync, 'source_id', futureAnyIds),
    ]);
    const syncMap = new Map();
    for (const s of [...legacySyncs, ...sourceSyncs.filter(s => s.source_type === 'GROUP_SCHEDULE_ITEM')]) syncMap.set(s.id, s);
    const syncs = [...syncMap.values()].sort(byId).map(s => {
      const itemId = s.group_schedule_item_id || s.source_id;
      const item = scheduleById[itemId];
      return { id: s.id, schedule_item_id: itemId, calendar_event_id: s.calendar_event_id, link: s.group_schedule_item_id ? 'LEGACY' : 'SOURCE', item_status: item?.status ?? null, action: item?.status === 'ACTIVE' ? 'DELETE_WITH_CANCELLATION' : 'EXISTING_LEFTOVER' };
    });
    const leftovers = syncs.filter(s => s.action === 'EXISTING_LEFTOVER').length;
    if (leftovers) warnings.push('CALENDAR_LEFTOVERS_FOR_CANCELLED_ITEMS');

    // CREATED_BY_MISTAKE: Quote-only commercial withdrawal. Never cancels a Group, so it is allowed only when the
    // linked Group is already closed and holds no current/future commitments; a live Group means the booking is real
    // (or must be cancelled explicitly as CUSTOMER_CANCELLED / reviewed) — never silently left occupying resources.
    const mistakeBlockers = [...baseBlockers];
    if (!GROUP_STATUSES.has(group.status)) mistakeBlockers.push('UNKNOWN_GROUP_STATUS');
    else if (!['CANCELLED', 'ARCHIVED'].includes(group.status)) mistakeBlockers.push('MISTAKEN_QUOTE_HAS_LIVE_GROUP');
    const liveCommitments = Object.values(resources).reduce((n, r) => n + r.counts.future + r.counts.today + r.counts.in_progress, 0);
    if (liveCommitments) mistakeBlockers.push('MISTAKEN_QUOTE_GROUP_HOLDS_RESOURCES');
    if (approvedQuoteIds.length > 1 || !approvedQuoteIds.includes(quote.id)) mistakeBlockers.push('QUOTE_GROUP_RELATIONSHIP_AMBIGUOUS');
    if (otherQuote.some(r => r.active) || orphaned.some(r => r.active) || quoteHolds.some(h => h.status === 'ACTIVE' && h.group_id !== gid)) mistakeBlockers.push('QUOTE_GROUP_RELATIONSHIP_AMBIGUOUS');
    if (Object.values(resources).some(r => r.counts.unknown_status || r.counts.invalid_dates)) mistakeBlockers.push('RESOURCE_STATE_UNCLEAR');

    const fingerprint = await sha256({
      v: 'B2.1', today, stay_evidence: stayEvidence, quote_holds: quoteHolds.sort(byId).map(r => pick(r, FP_KEYS)),
      quote: pick(quote, ['id', 'status', 'group_id', 'approved_option_key', 'updated_date']),
      group: pick(group, ['id', 'status', 'stay_mode', 'group_type', 'arrival_date', 'departure_date', 'operationally_active', 'updated_date']),
      approved_quote_ids: approvedQuoteIds,
      profiles: profiles.sort(byId).map(p => pick(p, FP_KEYS)),
      resources: Object.fromEntries([['stay_periods', periods], ['sleeping_allocations', allocations], ['neighborhood_reservations', neighborhoods], ['meal_reservations', meals], ['schedule_items', schedule], ['coffee_requests', coffee], ['prisa_requests', prisa], ['operational_holds', holds], ['mechina_space_requests', mechina]]
        .map(([k, rows]) => [k, [...rows].sort(byId).map(r => pick(r, FP_KEYS))])),
      shared_rows: [...sharedRows].sort(byId).map(r => pick(r, FP_KEYS)),
      calendar_syncs: [...syncMap.values()].sort(byId).map(s => pick(s, ['id', 'group_schedule_item_id', 'source_type', 'source_id', 'calendar_event_id', 'calendar_id', 'updated_date'])),
    });

    const publicResources = Object.fromEntries(Object.entries(resources).map(([k, { _future, ...rest }]) => [k, rest]));
    return Response.json({
      success: true,
      read_only: true,
      eligible: blockers.length === 0,
      commit_enabled: B2_COMMIT_ENABLED,
      requires_no_arrival_declaration: requiresNoArrivalDeclaration,
      stay_evidence: stayEvidence,
      possible_stay_signals: possibleStaySignals,
      fingerprint,
      today,
      timezone: 'Asia/Jerusalem',
      caller_role: auth.caller.role,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      reasons: {
        CUSTOMER_CANCELLED: { eligible: blockers.length === 0, blockers: [...new Set(blockers)], requires_no_arrival_declaration: requiresNoArrivalDeclaration, effect: 'GROUP_OPERATIONAL_CANCELLATION' },
        CREATED_BY_MISTAKE: { eligible: mistakeBlockers.length === 0, blockers: [...new Set(mistakeBlockers)], requires_no_arrival_declaration: false, effect: 'QUOTE_ONLY_WITHDRAWAL' },
      },
      quote: { id: quote.id, status: quote.status, quote_number: quote.quote_number || null, client_name: quote.client_name || null, approved_option_key: quote.approved_option_key || null, will_change: false },
      group: { id: group.id, group_name: group.group_name, status: group.status, stay_mode: group.stay_mode || 'CONTINUOUS', group_type: group.group_type, arrival_date: group.arrival_date, departure_date: group.departure_date || null },
      relationship: { canonical: 'Quote.group_id', approved_quote_ids_for_group: approvedQuoteIds, orphaned_quote_references: orphaned, references_to_other_quotes: otherQuote },
      intended_effects: { group_status: { from: group.status, to: 'CANCELLED' }, quote_status_unchanged: true, release_future_records_only: true, preserve_history: true },
      resources: publicResources,
      shared_activities: sharedActivities,
      shared_activity_items_without_id: flaggedNoId.map(i => i.id),
      mechina_link_issues: mechinaIssues,
      calendar: {
        counts: { total: syncs.length, delete_with_cancellation: syncs.length - leftovers, existing_leftovers: leftovers },
        records: syncs.slice(0, LIST_CAP),
        truncated: syncs.length > LIST_CAP,
        // Operational cancellation can complete while external calendar deletion remains outstanding.
        external_reconciliation_required: syncs.length > 0,
      },
    });
  } catch (error) {
    console.error('[previewQuoteBookingCancellation]', error?.code || error?.message);
    return Response.json({ success: false, error: error instanceof PreviewError ? error.code : 'PREVIEW_READ_FAILED' }, { status: 500 });
  }
}