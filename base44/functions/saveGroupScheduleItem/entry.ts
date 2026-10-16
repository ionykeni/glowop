import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { assertOperationalGroup, isPreparationGroupOperational } from '../../shared/quotePreparationConfig.js';
import { checkActivitySpaceConflict } from '../../shared/activitySpaceAvailability.js';
import { ACTIVITY_CALENDAR_ID, calendarDateTime } from '../../shared/activityCalendar.js';
import { validateDatedOperationalDate } from '../../shared/datedOperationalPeriodValidation.js';
import { isGroupDeparted, GROUP_ALREADY_DEPARTED_CODE } from '../../shared/activityCreationWindow.js';

const VALID_SPACE_CODES = new Set([
  'bunker_1', 'bunker_2', 'bunker_4', 'bunker_5',
  'bunker_6', 'bunker_7', 'bunker_8', 'ohel_moed', 'dining_hall',
  'outdoor_deck_lawn', 'rehavei_habayit',
  'boulder_1', 'boulder_2', 'boulder_3', 'boulder_4',
  'boulder_5', 'boulder_6', 'boulder_8',
]);

// Roles allowed to manage activities (mirrors roles.js MANAGE_ACTIVITIES)
const MANAGE_ACTIVITIES_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);
const BLOCK_REASON_LABELS = { PAINTING: 'צביעה', MAINTENANCE: 'תחזוקה', REPAIR: 'תיקון', SPECIAL_CLEANING: 'ניקיון מיוחד', TEMPORARILY_CLOSED: 'סגור זמנית', OTHER: 'אחר' };

async function resolveEffectiveRole(base44, user) {
  try {
    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const internalUser = internalUsers[0];
    const effectiveRole = internalUser?.role || user.role;
    console.log('[saveGroupScheduleItem] auth debug:', {
      email: user.email,
      platformRole: user.role,
      internalRole: internalUser?.role ?? null,
      effectiveRole,
      allowed: MANAGE_ACTIVITIES_ROLES.has(effectiveRole),
    });
    return effectiveRole;
  } catch (e) {
    console.warn('[saveGroupScheduleItem] could not load InternalUser, falling back to platform role:', e?.message);
    return user.role;
  }
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function reservationOverlapsBlock(block, date, startTime, endTime) {
  const reservationStart = `${date}T${startTime}`;
  const reservationEnd = `${date}T${endTime}`;
  const blockStart = `${block.start_date}T${block.start_time}`;
  if (block.is_open_ended) return reservationEnd > blockStart;
  return reservationStart < `${block.end_date}T${block.end_time}` && blockStart < reservationEnd;
}

// ── Explicit Google Calendar sync ────────────────────────────────────────────
// The entity automation "Sync Common Spaces to Google Calendar" does NOT reliably
// fire on service-role writes made from inside this backend function, and a nested
// functions.invoke() to the sync function does not run in this context either.
// So we mirror the item to Google Calendar DIRECTLY here after every successful
// create/update, for ALL edit scopes. Google Calendar is only a mirror — the app is
// the source of truth. Failures are swallowed — never block the activity save.
function buildCalendarEventPayload(item, space, group) {
  const spaceName = space.name || space.code;
  const groupName = group.group_name || 'קבוצה';
  const summary = `${item.activity_name} – ${groupName}`;

  const parts = [];
  parts.push(`📌 מרחב: ${spaceName} (${space.code})`);
  if (item.pax) parts.push(`👥 משתתפים: ${item.pax}`);
  if (item.split_total && item.split_index) parts.push(`🔀 פיצול: ${item.split_index}/${item.split_total}`);
  if (item.notes) parts.push(`📝 הערות: ${item.notes}`);

  const logistics = [];
  if (item.needs_projector) logistics.push('מקרן');
  if (item.needs_screen) logistics.push('מסך');
  if (item.needs_microphone) logistics.push('מיקרופון');
  if (item.needs_sound) logistics.push('הגברה');
  if (item.needs_whiteboard) logistics.push('לוח');
  if (item.needs_chair_circle) logistics.push('מעגל כיסאות');
  if (item.chairs_count) logistics.push(`${item.chairs_count} כיסאות`);
  if (item.logistics_other) logistics.push(item.logistics_other);
  if (logistics.length > 0) parts.push(`🔧 לוגיסטיקה: ${logistics.join(', ')}`);

  return {
    summary,
    description: parts.join('\n'),
    start: calendarDateTime(item.date, item.start_time),
    end: calendarDateTime(item.date, item.end_time),
    location: spaceName,
  };
}

async function syncItemToCalendar(base44, item) {
  if (!item || !item.id) return;
  try {
    const itemId = item.id;
    const activitySpaceId = item.activity_space_id;

    const existingSyncs = await base44.asServiceRole.entities.CalendarSync.filter({
      group_schedule_item_id: itemId,
    });

    const connection = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const accessToken = connection.accessToken;
    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };

    // ── Delete flow: cancelled OR no space assigned ──
    if (item.status === 'CANCELLED' || !activitySpaceId) {
      if (existingSyncs.length > 0) {
        const sr = existingSyncs[0];
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(sr.calendar_id || ACTIVITY_CALENDAR_ID)}/events/${encodeURIComponent(sr.calendar_event_id)}`,
          { method: 'DELETE', headers: authHeaders }
        ).catch(() => {});
        await base44.asServiceRole.entities.CalendarSync.delete(sr.id).catch(() => {});
      }
      return;
    }

    // ── Need space + group info ──
    const [spaces, groups] = await Promise.all([
      base44.asServiceRole.entities.ActivitySpace.filter({ id: activitySpaceId }),
      base44.asServiceRole.entities.Group.filter({ id: item.group_id }),
    ]);
    const space = spaces[0];
    const group = groups[0];
    if (!space || !group) return;

    const eventPayload = buildCalendarEventPayload(item, space, group);

    if (existingSyncs.length > 0) {
      const sr = existingSyncs[0];
      // Update the SAME event → no duplicates
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ACTIVITY_CALENDAR_ID)}/events/${encodeURIComponent(sr.calendar_event_id)}`,
        { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(eventPayload) }
      );
      if (!res.ok) {
        // Missing/deleted Google event → recreate and repoint the sync record
        if (res.status === 404 || res.status === 410) {
          const recreateRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ACTIVITY_CALENDAR_ID)}/events`,
            { method: 'POST', headers: jsonHeaders, body: JSON.stringify(eventPayload) }
          );
          const recreated = await recreateRes.json();
          if (recreateRes.ok) {
            await base44.asServiceRole.entities.CalendarSync.update(sr.id, {
              calendar_event_id: recreated.id,
              calendar_id: ACTIVITY_CALENDAR_ID,
            });
          }
        }
      } else if ((sr.calendar_id || ACTIVITY_CALENDAR_ID) !== ACTIVITY_CALENDAR_ID) {
        // Normalize calendar id on the record
        await base44.asServiceRole.entities.CalendarSync.update(sr.id, { calendar_id: ACTIVITY_CALENDAR_ID });
      }
      return;
    }

    // No sync record → create event + save sync record
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ACTIVITY_CALENDAR_ID)}/events`,
      { method: 'POST', headers: jsonHeaders, body: JSON.stringify(eventPayload) }
    );
    const created = await res.json();
    if (res.ok) {
      await base44.asServiceRole.entities.CalendarSync.create({
        group_schedule_item_id: itemId,
        calendar_event_id: created.id,
        calendar_id: ACTIVITY_CALENDAR_ID,
      });
    }
  } catch (e) {
    console.warn('[saveGroupScheduleItem] calendar sync failed (non-blocking) for item', item?.id, ':', e?.message);
  }
}

// Sync a list of item ids by loading each fresh record then mirroring it.
async function syncItemsByIds(base44, ids) {
  for (const id of ids) {
    if (!id) continue;
    try {
      const fresh = await base44.asServiceRole.entities.GroupScheduleItem.get(id);
      if (fresh) await syncItemToCalendar(base44, fresh);
    } catch (e) {
      console.warn('[saveGroupScheduleItem] could not load item for sync', id, ':', e?.message);
    }
  }
}

// Fetch groups by ids safely — no $in, loop of .get()
async function fetchGroupsByIds(base44, ids) {
  const results = [];
  for (const id of ids) {
    try {
      const g = await base44.asServiceRole.entities.Group.get(id);
      if (g) results.push(g);
    } catch { /* not found — skip */ }
  }
  return results;
}

// Recompute shared_activity snapshot for all items sharing a shared_activity_id.
// If only 1 item remains, clears shared metadata from it.
// Uses filter by shared_activity_id (a simple equality filter, not $in).
async function recomputeSharedSnapshot(base44, sharedActivityId) {
  if (!sharedActivityId) return;
  const linked = await base44.asServiceRole.entities.GroupScheduleItem.filter({
    shared_activity_id: sharedActivityId,
    status: 'ACTIVE',
  });

  if (linked.length <= 1) {
    // Clear shared metadata — not truly shared anymore
    for (const item of linked) {
      await base44.asServiceRole.entities.GroupScheduleItem.update(item.id, {
        shared_activity_id: null,
        shared_activity_created_from_group_id: null,
        shared_activity_group_ids: null,
        shared_activity_group_names: null,
        is_shared_activity: false,
      });
    }
    return;
  }

  // Fetch group names — safe loop, no $in
  const groupIds = [...new Set(linked.map(i => i.group_id))];
  const groups = await fetchGroupsByIds(base44, groupIds);
  const groupNameMap = Object.fromEntries(groups.map(g => [g.id, g.group_name]));

  const ids = linked.map(i => i.group_id);
  const names = linked.map(i => groupNameMap[i.group_id] || i.group_id);

  for (const item of linked) {
    await base44.asServiceRole.entities.GroupScheduleItem.update(item.id, {
      shared_activity_group_ids: JSON.stringify(ids),
      shared_activity_group_names: JSON.stringify(names),
      is_shared_activity: true,
    });
  }
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth & permission check ───────────────────────────────────────────────
    let user = null;
    try { user = await base44.auth.me(); } catch { /* unauthenticated */ }
    if (!user) {
      return Response.json({ success: false, error: 'נדרשת התחברות' }, { status: 401 });
    }
    const effectiveRole = await resolveEffectiveRole(base44, user);
    if (!MANAGE_ACTIVITIES_ROLES.has(effectiveRole)) {
      return Response.json({ success: false, error: 'אין הרשאה לניהול פעילויות' }, { status: 403 });
    }

    const body = await req.json();
    const {
      id,
      group_id,
      operational_group_profile_id,
      date,
      start_time,
      end_time,
      activity_name,
      requested_location,
      activity_space_id,
      quote_item_id,
      split_group_id,
      split_index,
      split_total,
      // Shared activity fields
      shared_activity_id,
      shared_activity_created_from_group_id,
      // Extra groups for shared activity creation
      extra_group_ids,
      // Edit scope for shared activities
      edit_scope, // "one" | "all"
      // unlink flag — if true, unlink this item from shared activity
      unlink_from_shared,
      pax,
      notes,
      needs_projector,
      needs_screen,
      needs_microphone,
      needs_sound,
      needs_whiteboard,
      needs_chair_circle,
      chairs_count,
      logistics_other,
      source,
      status,
    } = body;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!group_id || !operational_group_profile_id) {
      return Response.json({ success: false, error: 'חסרים פרטי קבוצה או פרופיל תפעולי' }, { status: 400 });
    }
    if (!activity_name) {
      return Response.json({ success: false, error: 'חסר שם פעילות' }, { status: 400 });
    }
    if (!date) {
      return Response.json({ success: false, error: 'חסר תאריך פעילות' }, { status: 400 });
    }
    if (!start_time || !end_time) {
      return Response.json({ success: false, error: 'חסרות שעות פעילות' }, { status: 400 });
    }
    if (timeToMinutes(start_time) >= timeToMinutes(end_time)) {
      return Response.json({ success: false, error: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה' }, { status: 400 });
    }

    // ── Validate date is within primary group booking window ─────────────────
    let primaryGroup = null;
    try { primaryGroup = await base44.asServiceRole.entities.Group.get(group_id); } catch {}
    if (!primaryGroup) {
      return Response.json({ success: false, error: 'הקבוצה לא נמצאה' }, { status: 404 });
    }
    try { assertOperationalGroup(primaryGroup); } catch (error) { return Response.json({ success: false, error: error.code }, { status: 409 }); }
    const primaryDateValidation = await validateDatedOperationalDate(base44, primaryGroup, date);
    if (!primaryDateValidation.valid) {
      return Response.json({ success: false, error: primaryDateValidation.message, error_code: primaryDateValidation.code }, { status: 400 });
    }
    if (primaryGroup.arrival_date && primaryGroup.departure_date) {
      if (date < primaryGroup.arrival_date || date > primaryGroup.departure_date) {
        return Response.json({ success: false, error: 'לא ניתן לקבוע פעילות מחוץ לתאריכי הקבוצה' }, { status: 400 });
      }
    }

    // ── Block creating NEW activities for a group that has already departed ──
    // (today is strictly after departure_date — i.e. the day after checkout or later).
    // Edits (id present) and cancellations remain allowed.
    if (!id && status !== 'CANCELLED' && isGroupDeparted(primaryGroup)) {
      return Response.json({ success: false, error: `הקבוצה "${primaryGroup.group_name || ''}" כבר עזבה את האתר — לא ניתן להוסיף פעילויות`, error_code: GROUP_ALREADY_DEPARTED_CODE }, { status: 400 });
    }

    let resolvedSpaceId = activity_space_id || null;
    let resolvedSpaceCode = null;

    // Determine the shared_activity_id that should be excluded from conflict checks
    // (linked clones of the same activity must not block each other)
    const excludeSharedId = shared_activity_id || null;

    // ── Conflict check helper ─────────────────────────────────────────────────
    // excludeItemId: the item being edited (don't conflict with itself)
    // excludeSharedActivityId: items in same shared activity don't conflict with each other
    const checkConflict = async (spaceId, excludeItemId, excludeSharedActivityId) => {
      if (!spaceId || status === 'CANCELLED') return null;
      const spaces = await base44.asServiceRole.entities.ActivitySpace.filter({ id: spaceId });
      const space = spaces[0];
      if (!space) return 'מרחב הפעילות שנבחר אינו קיים.';
      if (!VALID_SPACE_CODES.has(space.code)) return `הקוד "${space.code}" אינו מרחב פעילות תקני.`;
      const conflict = await checkActivitySpaceConflict(base44, {
        spaceId,
        date,
        startTime: start_time,
        endTime: end_time,
        excludeGroupItemId: excludeItemId,
        excludeSharedActivityId,
      });
      if (!conflict) return null;
      const details = conflict.conflicting_title ? ` — ${conflict.conflicting_title} (${conflict.start_time || ''}–${conflict.end_time || ''})` : '';
      return `${conflict.message || 'המרחב כבר תפוס בשעה שנבחרה'}${details}`;
    };

    // Resolve space code
    if (resolvedSpaceId) {
      const spaceRows = await base44.asServiceRole.entities.ActivitySpace.filter({ id: resolvedSpaceId });
      const sp = spaceRows[0];
      if (sp && VALID_SPACE_CODES.has(sp.code)) resolvedSpaceCode = sp.code;
    }

    const basePayload = {
      group_id,
      operational_group_profile_id,
      date,
      start_time,
      end_time,
      activity_name,
      requested_location: requested_location || null,
      activity_space_id: resolvedSpaceId,
      activity_space_code: resolvedSpaceCode,
      quote_item_id: quote_item_id || null,
      split_group_id: split_group_id || null,
      split_index: split_index != null ? Number(split_index) : null,
      split_total: split_total != null ? Number(split_total) : null,
      pax: pax ? Number(pax) : null,
      notes: notes || null,
      needs_projector:    !!needs_projector,
      needs_screen:       !!needs_screen,
      needs_microphone:   !!needs_microphone,
      needs_sound:        !!needs_sound,
      needs_whiteboard:   !!needs_whiteboard,
      needs_chair_circle: !!needs_chair_circle,
      chairs_count:       chairs_count ? Number(chairs_count) : null,
      logistics_other:    logistics_other || null,
      source: source || 'manual',
      status: status || 'ACTIVE',
    };

    // ── CASE: Convert normal item to shared (id + extra_group_ids, no edit_scope) ──
    if (id && extra_group_ids && extra_group_ids.length > 0 && !edit_scope) {
      let currentItem = null;
      try { currentItem = await base44.asServiceRole.entities.GroupScheduleItem.get(id); } catch {}
      if (!currentItem) return Response.json({ success: false, error: 'הפעילות לא נמצאה' }, { status: 404 });

      // Only convert if not already shared
      if (currentItem.shared_activity_id) {
        return Response.json({ success: false, error: 'הפעילות כבר משותפת — ערוך דרך edit_scope' }, { status: 400 });
      }

      const allGroupIds = [group_id, ...extra_group_ids];

      // Phase 1: Validate all groups and profiles
      const allGroups = await fetchGroupsByIds(base44, allGroupIds);
      const groupMap = Object.fromEntries(allGroups.map(g => [g.id, g]));

      for (const gid of allGroupIds) {
        const g = groupMap[gid];
        if (!g) return Response.json({ success: false, error: `הקבוצה לא נמצאה: ${gid}` }, { status: 404 });
        const groupDateValidation = await validateDatedOperationalDate(base44, g, date);
        if (!groupDateValidation.valid) return Response.json({ success: false, error: groupDateValidation.message, error_code: groupDateValidation.code, group_id: gid }, { status: 400 });
        if (!isPreparationGroupOperational(g)) return Response.json({ success: false, error: 'PREPARATION_GROUP_NOT_OPERATIONAL', group_id: gid }, { status: 409 });
        if (gid !== group_id && isGroupDeparted(g)) {
          return Response.json({ success: false, error: `הקבוצה "${g.group_name}" כבר עזבה את האתר — לא ניתן להוסיף פעילויות`, error_code: GROUP_ALREADY_DEPARTED_CODE, group_id: gid }, { status: 400 });
        }
        if (g.arrival_date && g.departure_date) {
          const stayStart = g.arrival_date < g.departure_date ? g.arrival_date : g.departure_date;
          const stayEnd   = g.arrival_date < g.departure_date ? g.departure_date : g.arrival_date;
          if (date < stayStart || date > stayEnd) {
            return Response.json({
              success: false,
              error: `הקבוצה "${g.group_name}" אינה נמצאת באתר בתאריך ${date} (שהות: ${stayStart} עד ${stayEnd})`,
            }, { status: 400 });
          }
        }
      }

      const profileMap = {};
      for (const extraGroupId of extra_group_ids) {
        const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: extraGroupId });
        const profile = profiles[0];
        if (!profile) {
          const groupName = groupMap[extraGroupId]?.group_name || extraGroupId;
          return Response.json({ success: false, error: `לא נמצא פרופיל תפעולי לקבוצה: ${groupName}` }, { status: 400 });
        }
        profileMap[extraGroupId] = profile;
      }

      // Phase 2: Conflict check (exclude current item from conflict)
      if (resolvedSpaceId) {
        const newSharedIdTemp = 'temp-convert';
        const conflictErr = await checkConflict(resolvedSpaceId, id, null);
        if (conflictErr) return Response.json({ success: false, error: conflictErr }, { status: 409 });
      }

      // Phase 3: Create shared activity
      const newSharedId = crypto.randomUUID();
      const groupNames = allGroupIds.map(gid => groupMap[gid]?.group_name || gid);
      const sharedMeta = {
        shared_activity_id: newSharedId,
        shared_activity_created_from_group_id: group_id,
        is_shared_activity: true,
        shared_activity_group_ids: JSON.stringify(allGroupIds),
        shared_activity_group_names: JSON.stringify(groupNames),
      };

      const createdIds = [id];
      try {
        // Update the existing item
        await base44.asServiceRole.entities.GroupScheduleItem.update(id, { ...basePayload, ...sharedMeta });

        // Create clones for extra groups
        for (const extraGroupId of extra_group_ids) {
          const extraProfile = profileMap[extraGroupId];
          const clone = await base44.asServiceRole.entities.GroupScheduleItem.create({
            ...basePayload,
            group_id: extraGroupId,
            operational_group_profile_id: extraProfile.id,
            // Clones never inherit split metadata — the split belongs to the source group only
            split_group_id: null,
            split_index: null,
            split_total: null,
            ...sharedMeta,
          });
          createdIds.push(clone.id);
        }

        // Sync every affected item to Google Calendar
        await syncItemsByIds(base44, createdIds);

        return Response.json({
          success: true,
          converted_to_shared: true,
          shared_activity_id: newSharedId,
          group_count: allGroupIds.length,
          created_count: createdIds.length,
          created_ids: createdIds,
        });
      } catch (err) {
        // Rollback clones (don't cancel the original)
        for (const cid of createdIds.slice(1)) {
          await base44.asServiceRole.entities.GroupScheduleItem.update(cid, { status: 'CANCELLED' }).catch(() => {});
        }
        // Revert original
        await base44.asServiceRole.entities.GroupScheduleItem.update(id, {
          shared_activity_id: null, shared_activity_created_from_group_id: null,
          is_shared_activity: false, shared_activity_group_ids: null, shared_activity_group_names: null,
        }).catch(() => {});
        return Response.json({ success: false, error: 'המרת הפעילות למשותפת נכשלה. כל הרשומות שנוצרו בוטלו.' }, { status: 500 });
      }
    }

    // ── CASE: Editing existing item with edit_scope ───────────────────────────
    if (id && edit_scope) {
      let currentItem = null;
      try { currentItem = await base44.asServiceRole.entities.GroupScheduleItem.get(id); } catch {}
      if (!currentItem) return Response.json({ success: false, error: 'הפעילות לא נמצאה' }, { status: 404 });

      const currentSharedId = currentItem.shared_activity_id;

      if (edit_scope === 'one') {
        const sharedFieldsChanged = unlink_from_shared;

        const conflictErr = await checkConflict(resolvedSpaceId, id, sharedFieldsChanged ? null : currentSharedId);
        if (conflictErr) return Response.json({ success: false, error: conflictErr }, { status: 409 });

        if (sharedFieldsChanged && currentSharedId) {
          // Unlink this item from the shared activity
          const updatedItem = {
            ...basePayload,
            // Preserve split metadata — split and shared are independent dimensions
            split_group_id: split_group_id ?? currentItem.split_group_id ?? null,
            split_index: split_index ?? currentItem.split_index ?? null,
            split_total: split_total ?? currentItem.split_total ?? null,
            shared_activity_id: null,
            shared_activity_created_from_group_id: null,
            shared_activity_group_ids: null,
            shared_activity_group_names: null,
            is_shared_activity: false,
          };
          const result = await base44.asServiceRole.entities.GroupScheduleItem.update(id, updatedItem);
          // Recompute snapshot for remaining items
          await recomputeSharedSnapshot(base44, currentSharedId);
          await syncItemToCalendar(base44, result);
          return Response.json({ success: true, item: result, unlinked: true });
        } else {
          // Update only this item, keep its shared_activity_id
          const result = await base44.asServiceRole.entities.GroupScheduleItem.update(id, {
            ...basePayload,
            // Preserve split metadata if the body didn't carry it — split and shared are independent
            split_group_id: split_group_id ?? currentItem.split_group_id ?? null,
            split_index: split_index ?? currentItem.split_index ?? null,
            split_total: split_total ?? currentItem.split_total ?? null,
            shared_activity_id: currentItem.shared_activity_id || null,
            shared_activity_created_from_group_id: currentItem.shared_activity_created_from_group_id || null,
            shared_activity_group_ids: currentItem.shared_activity_group_ids || null,
            shared_activity_group_names: currentItem.shared_activity_group_names || null,
            is_shared_activity: currentItem.is_shared_activity || false,
          });
          await syncItemToCalendar(base44, result);
          return Response.json({ success: true, item: result });
        }
      }

      if (edit_scope === 'all' && currentSharedId) {
        // Conflict check — exclude own shared_activity_id so linked items don't block each other
        const conflictErr = await checkConflict(resolvedSpaceId, null, currentSharedId);
        if (conflictErr) return Response.json({ success: false, error: conflictErr }, { status: 409 });

        // Get all linked items
        const allLinked = await base44.asServiceRole.entities.GroupScheduleItem.filter({
          shared_activity_id: currentSharedId,
          status: 'ACTIVE',
        });
        const linkedGroups = await fetchGroupsByIds(base44, [...new Set(allLinked.map(item => item.group_id))]);
        for (const linkedGroup of linkedGroups) {
          const linkedDateValidation = await validateDatedOperationalDate(base44, linkedGroup, date);
          if (!linkedDateValidation.valid) return Response.json({ success: false, error: linkedDateValidation.message, error_code: linkedDateValidation.code, group_id: linkedGroup.id }, { status: 400 });
        }

        // Update all — preserve each item's group_id and operational_group_profile_id.
        // Keep the freshly-updated objects so calendar sync uses the NEW values directly
        // (a re-fetch here can read stale data before the write propagates).
        const updatedLinked = [];
        for (const linkedItem of allLinked) {
          const updated = await base44.asServiceRole.entities.GroupScheduleItem.update(linkedItem.id, {
            ...basePayload,
            group_id: linkedItem.group_id,
            operational_group_profile_id: linkedItem.operational_group_profile_id,
            // Preserve each linked item's OWN split metadata — never overwrite one dimension with the other
            split_group_id: linkedItem.split_group_id || null,
            split_index: linkedItem.split_index ?? null,
            split_total: linkedItem.split_total ?? null,
            shared_activity_id: currentSharedId,
            shared_activity_created_from_group_id: currentItem.shared_activity_created_from_group_id,
          });
          updatedLinked.push(updated);
        }

        await recomputeSharedSnapshot(base44, currentSharedId);
        // Sync each linked item straight from its updated record — no stale re-fetch.
        for (const u of updatedLinked) {
          await syncItemToCalendar(base44, u);
        }
        return Response.json({ success: true, updated_all: true, count: updatedLinked.length });
      }

      // Fallback: normal update (edit_scope present but no sharedId)
      const conflictErr = await checkConflict(resolvedSpaceId, id, currentSharedId);
      if (conflictErr) return Response.json({ success: false, error: conflictErr }, { status: 409 });
      const result = await base44.asServiceRole.entities.GroupScheduleItem.update(id, basePayload);
      await syncItemToCalendar(base44, result);
      return Response.json({ success: true, item: result });
    }

    // ── CASE: Normal single item save (no extra groups) ───────────────────────
    if (!extra_group_ids || extra_group_ids.length === 0) {
      // Split-modal edits don't carry shared fields in the body — use the stored
      // shared_activity_id so linked clones of the same activity don't block the save.
      let effectiveSharedId = excludeSharedId;
      if (id && !effectiveSharedId) {
        try {
          const cur = await base44.asServiceRole.entities.GroupScheduleItem.get(id);
          effectiveSharedId = cur?.shared_activity_id || null;
        } catch { /* not found — keep null */ }
      }
      if (resolvedSpaceId && status !== 'CANCELLED') {
        const conflictErr = await checkConflict(resolvedSpaceId, id || null, effectiveSharedId);
        if (conflictErr) return Response.json({ success: false, error: conflictErr }, { status: 409 });
      }

      let result;
      if (id) {
        result = await base44.asServiceRole.entities.GroupScheduleItem.update(id, basePayload);
      } else {
        result = await base44.asServiceRole.entities.GroupScheduleItem.create(basePayload);
      }

      // Post-write race-condition check uses the same shared 15-minute rule.
      if (resolvedSpaceId && status !== 'CANCELLED') {
        const postConflict = await checkActivitySpaceConflict(base44, {
          spaceId: resolvedSpaceId,
          date,
          startTime: start_time,
          endTime: end_time,
          excludeGroupItemId: result.id,
          excludeSharedActivityId: effectiveSharedId,
        });
        if (postConflict) {
          await base44.asServiceRole.entities.GroupScheduleItem.update(result.id, { status: 'CANCELLED' });
          return Response.json({ success: false, error: postConflict.message || 'המרחב כבר תפוס בשעה הזו. יש לבחור שעה אחרת או מרחב אחר.', conflict: postConflict }, { status: 409 });
        }
      }

      // Explicit Google Calendar sync — create OR update, single item path.
      // Passing the fresh result guarantees date/time/title/location/notes mirror correctly.
      await syncItemToCalendar(base44, result);
      return Response.json({ success: true, item: result });
    }

    // ── CASE: Shared activity — create for current group + extra groups ────────
    // ── Phase 1: Validate ALL groups and profiles before creating anything ────
    const allGroupIds = [group_id, ...extra_group_ids];

    // Fetch all groups safely (no $in)
    const allGroups = await fetchGroupsByIds(base44, allGroupIds);
    const groupMap = Object.fromEntries(allGroups.map(g => [g.id, g]));

    // Validate every group exists and date is within its stay
    for (const gid of allGroupIds) {
      const g = groupMap[gid];
      if (!g) {
        return Response.json({ success: false, error: `הקבוצה לא נמצאה: ${gid}` }, { status: 404 });
      }
      const groupDateValidation = await validateDatedOperationalDate(base44, g, date);
      if (!groupDateValidation.valid) return Response.json({ success: false, error: groupDateValidation.message, error_code: groupDateValidation.code, group_id: gid }, { status: 400 });
      if (isGroupDeparted(g)) {
        return Response.json({ success: false, error: `הקבוצה "${g.group_name}" כבר עזבה את האתר — לא ניתן להוסיף פעילויות`, error_code: GROUP_ALREADY_DEPARTED_CODE, group_id: gid }, { status: 400 });
      }
      if (g.arrival_date && g.departure_date) {
        // Defensive: handle inverted dates by using min/max
        const stayStart = g.arrival_date < g.departure_date ? g.arrival_date : g.departure_date;
        const stayEnd   = g.arrival_date < g.departure_date ? g.departure_date : g.arrival_date;
        if (date < stayStart || date > stayEnd) {
          return Response.json({
            success: false,
            error: `הקבוצה "${g.group_name}" אינה נמצאת באתר בתאריך ${date} (שהות: ${stayStart} עד ${stayEnd})`,
          }, { status: 400 });
        }
      }
    }

    // Fetch operational profiles for extra groups — safe loop, no $in
    // Never fall back to primary group's profile
    const profileMap = {};
    for (const extraGroupId of extra_group_ids) {
      const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({
        group_id: extraGroupId,
      });
      const profile = profiles[0];
      if (!profile) {
        const groupName = groupMap[extraGroupId]?.group_name || extraGroupId;
        return Response.json({
          success: false,
          error: `לא נמצא פרופיל תפעולי לקבוצה: ${groupName}`,
        }, { status: 400 });
      }
      profileMap[extraGroupId] = profile;
    }

    // ── Phase 2: Conflict check before creating any record ────────────────────
    const newSharedId = crypto.randomUUID();

    if (resolvedSpaceId) {
      // newSharedId doesn't exist yet — pass null so no items are excluded
      const conflictErr = await checkConflict(resolvedSpaceId, null, null);
      if (conflictErr) return Response.json({ success: false, error: conflictErr }, { status: 409 });
    }

    // ── Phase 3: Create all records with rollback on any failure ──────────────
    const createdIds = [];
    try {
      // Create primary group item
      const primaryItem = await base44.asServiceRole.entities.GroupScheduleItem.create({
        ...basePayload,
        shared_activity_id: newSharedId,
        shared_activity_created_from_group_id: group_id,
        is_shared_activity: true,
      });
      createdIds.push(primaryItem.id);

      // Create clones for extra groups — each gets its own validated profile
      for (const extraGroupId of extra_group_ids) {
        const extraProfile = profileMap[extraGroupId]; // guaranteed to exist from Phase 1
        const clonePayload = {
          ...basePayload,
          group_id: extraGroupId,
          operational_group_profile_id: extraProfile.id, // no fallback — profile is required
          shared_activity_id: newSharedId,
          shared_activity_created_from_group_id: group_id,
          is_shared_activity: true,
        };
        const cloneItem = await base44.asServiceRole.entities.GroupScheduleItem.create(clonePayload);
        createdIds.push(cloneItem.id);
      }

      // Compute group name snapshots
      const groupNames = allGroupIds.map(gid => groupMap[gid]?.group_name || gid);
      for (const createdId of createdIds) {
        await base44.asServiceRole.entities.GroupScheduleItem.update(createdId, {
          shared_activity_group_ids: JSON.stringify(allGroupIds),
          shared_activity_group_names: JSON.stringify(groupNames),
        });
      }

      // Sync every created item to Google Calendar
      await syncItemsByIds(base44, createdIds);

      return Response.json({
        success: true,
        shared_activity_id: newSharedId,
        created_count: createdIds.length,
        group_count: allGroupIds.length,
        created_ids: createdIds,
      });

    } catch (err) {
      // Rollback all created items
      for (const cid of createdIds) {
        await base44.asServiceRole.entities.GroupScheduleItem.update(cid, { status: 'CANCELLED' }).catch(() => {});
      }
      console.error('[saveGroupScheduleItem] shared activity creation failed, rolled back:', err?.message);
      return Response.json({
        success: false,
        error: 'יצירת הפעילות המשותפת נכשלה. כל הרשומות שנוצרו בוטלו. נסה שוב.',
      }, { status: 500 });
    }

  } catch (err) {
    console.error('[saveGroupScheduleItem] unexpected error:', err?.message, err?.stack);
    return Response.json({ success: false, error: 'שגיאה פנימית בשמירת פעילות', debug: { message: err?.message } }, { status: 500 });
  }
}