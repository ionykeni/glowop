import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { assertOperationalGroup } from '../../shared/quotePreparationConfig.js';

/**
 * Hotel-night overlap rule:
 *   arrival_date is inclusive (first sleeping night)
 *   departure_date is exclusive (checkout day — does NOT block that night)
 *   Same-day checkout / check-in is therefore allowed.
 */
function datesOverlap(a1, a2, b1, b2) {
  if (!a1 || !a2 || !b1 || !b2) return false;
  return a1 < b2 && b1 < a2;
}

function isValidDate(str) {
  if (!str || typeof str !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function fail(reasonCode, errorMsg, dbg) {
  console.error(`[saveVipSleepingAllocation] FAIL: ${reasonCode} — ${errorMsg}`, JSON.stringify(dbg));
  // Return 200 so the SDK doesn't throw — frontend checks success:false
  return Response.json({ success: false, error: errorMsg, debug: { reasonCode, ...dbg } }, { status: 200 });
}

Deno.serve(async (req) => {
  // ── Top-level try/catch: catches any unexpected exception ─────────────────
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));

    // ── Auth — same pattern as saveGroupScheduleItem / confirmSleepingAllocations ──
    // auth.me() is best-effort: if it throws (e.g. session not forwarded in some
    // publishing contexts) we log a warning but do NOT block the operation,
    // since all entity writes go through asServiceRole anyway.
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (authErr) {
      console.warn('[saveVipSleepingAllocation] auth.me() threw (non-fatal):', authErr?.message);
    }

    if (!user) {
      console.warn('[saveVipSleepingAllocation] no authenticated user — proceeding with service role only');
    } else {
      console.log(`[saveVipSleepingAllocation] user: ${user.email} role: ${user.role}`);
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    let body;
    try {
      body = await req.json();
    } catch (parseErr) {
      return Response.json({
        success: false,
        error: 'חסרים פרטי שיבוץ VIP',
        debug: { reasonCode: 'BODY_PARSE_ERROR', message: parseErr?.message },
      }, { status: 400 });
    }

    const {
      allocation_id,
      group_id,
      operational_group_profile_id,
      tent_id,
      requirement_index,
      gender_group,
      allocated_pax,
      notes,
      effective_date,
    } = body;

    console.log('[saveVipSleepingAllocation] received payload:', JSON.stringify({
      allocation_id, group_id, operational_group_profile_id, tent_id,
      requirement_index, gender_group, allocated_pax,
    }));

    // Base debug context — grows as we load data
    const dbg = {
      hasAuthUser:                  !!user,
      userEmail:                    user?.email ?? null,
      userRole:                     user?.role  ?? null,
      receivedPayload: {
        allocation_id, group_id, operational_group_profile_id, tent_id,
        requirement_index, gender_group, allocated_pax,
      },
      tent_id:                      tent_id        ?? null,
      tent_code:                    null,
      tent_is_vip:                  null,
      tent_capacity:                null,
      tent_working_status:          null,
      tent_neighborhood_id:         null,
      group_id:                     group_id       ?? null,
      operational_group_profile_id: operational_group_profile_id ?? null,
      arrival_date:                 null,
      departure_date:               null,
      allocated_pax:                allocated_pax  ?? null,
      gender_group:                 gender_group   ?? null,
      requirement_index:            requirement_index ?? null,
      existingActiveAllocationsCount: null,
      conflictingAllocationIds:     [],
    };

    // ── 1. Input validation ──────────────────────────────────────────────────

    if (!group_id || !operational_group_profile_id || !tent_id || requirement_index == null) {
      return fail('MISSING_INPUT', 'חסרים פרטי שיבוץ VIP', dbg);
    }
    if (!gender_group || !['MEN', 'WOMEN'].includes(gender_group)) {
      return fail('INVALID_GENDER', 'יש לבחור מגדר (גברים/נשים)', dbg);
    }
    const pax = Number(allocated_pax);
    if (!pax || pax < 1 || pax > 4) {
      return fail('INVALID_PAX', 'מקסימום 4 אנשים לאוהל VIP', dbg);
    }

    // ── 2. Load & validate tent ──────────────────────────────────────────────

    let tent;
    try {
      const tents = await base44.asServiceRole.entities.Tent.filter({ id: tent_id });
      tent = tents[0] || null;
    } catch (e) {
      console.error('[saveVipSleepingAllocation] Tent.filter error:', e?.message);
      tent = null;
    }

    if (!tent) return fail('TENT_NOT_FOUND', 'האוהל לא נמצא במערכת', dbg);

    dbg.tent_code            = tent.code;
    dbg.tent_is_vip          = tent.tent_type;
    dbg.tent_capacity        = tent.capacity;
    dbg.tent_working_status  = tent.working_status;
    dbg.tent_neighborhood_id = tent.neighborhood_id;

    if (tent.tent_type !== 'VIP') {
      return fail('TENT_NOT_VIP', 'האוהל שנבחר אינו אוהל VIP', dbg);
    }
    if (tent.working_status !== 'WORKING') {
      return fail('TENT_NOT_WORKING', 'האוהל אינו זמין לשימוש', dbg);
    }
    // VIP and accessible tents support an operational override of up to 4.
    // We do NOT block on tent.capacity for VIP tents — the operational max is 4.
    const VIP_OPERATIONAL_MAX = 4;
    const isVipTent = tent.tent_type === 'VIP' || tent.is_accessible === true || String(tent.code || '').match(/^8\d/);
    const operationalMax = isVipTent ? VIP_OPERATIONAL_MAX : tent.capacity;
    if (pax > operationalMax) {
      return fail('PAX_EXCEEDS_CAPACITY', `מקסימום ${operationalMax} אנשים לאוהל זה`, dbg);
    }

    // ── 3. Load VIP neighborhood for this tent ───────────────────────────────

    let neighborhood;
    try {
      const hoods = await base44.asServiceRole.entities.Neighborhood.filter({ id: tent.neighborhood_id });
      neighborhood = hoods[0] || null;
    } catch (e) {
      console.error('[saveVipSleepingAllocation] Neighborhood.filter error:', e?.message);
      neighborhood = null;
    }

    if (!neighborhood || !neighborhood.is_vip) {
      return fail('NOT_VIP_NEIGHBORHOOD', 'האוהל שנבחר אינו נמצא במתחם VIP', dbg);
    }

    // ── 4. Load profile → authoritative arrival/departure dates ─────────────

    let profile;
    try {
      const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ id: operational_group_profile_id });
      profile = profiles[0] || null;
    } catch (e) {
      console.error('[saveVipSleepingAllocation] Profile.filter error:', e?.message);
      profile = null;
    }

    if (!profile || profile.group_id !== group_id) {
      return fail('PROFILE_NOT_FOUND', 'חסרים פרטי קבוצה או פרופיל תפעולי', dbg);
    }

    // ── Load Group for authoritative dates (Group is source of truth) ──────────
    let group = null;
    try {
      const groups = await base44.asServiceRole.entities.Group.filter({ id: group_id });
      group = groups[0] || null;
    } catch (e) {
      console.error('[saveVipSleepingAllocation] Group.filter error:', e?.message);
    }
    try { assertOperationalGroup(group); } catch (error) { return fail(error.code, 'הקבוצה עדיין אינה פעילה תפעולית', dbg); }

    const groupArrivalRaw   = group?.arrival_date   || group?.check_in_date  || group?.start_date  || null;
    const groupDepartureRaw = group?.departure_date || group?.check_out_date || group?.end_date    || null;
    const profileArrivalRaw   = profile.arrival_date   || profile.check_in_date  || profile.start_date  || null;
    const profileDepartureRaw = profile.departure_date || profile.check_out_date || profile.end_date    || null;

    // Group dates preferred; profile dates only as fallback
    let arrival_date   = groupArrivalRaw   || profileArrivalRaw   || null;
    let departure_date = groupDepartureRaw || profileDepartureRaw || null;

    dbg.arrival_date   = arrival_date;
    dbg.departure_date = departure_date;

    if (!arrival_date || !departure_date) {
      return fail('DATES_MISSING', 'חסרים תאריכי הגעה או עזיבה לקבוצה', dbg);
    }
    // Normalize to date-only (YYYY-MM-DD) — fields may contain ISO timestamps
    const finalArrivalBeforeNormalize   = arrival_date;
    const finalDepartureBeforeNormalize = departure_date;
    arrival_date   = String(arrival_date).slice(0, 10);
    departure_date = String(departure_date).slice(0, 10);
    const todayIL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const noteMarker = `__vip_req_${requirement_index}__`;
    let groupAllocs = [];
    try {
      groupAllocs = await base44.asServiceRole.entities.SleepingAllocation.filter({ group_id });
    } catch (e) {
      console.error('[saveVipSleepingAllocation] SleepingAllocation.filter (group) error:', e?.message);
    }
    const isActiveContinuousCreate = group?.stay_mode === 'CONTINUOUS' && group.arrival_date <= todayIL && todayIL < group.departure_date && !allocation_id;
    if (isActiveContinuousCreate) {
      const requestedEffectiveDate = String(effective_date || '').slice(0, 10);
      if (!isValidDate(requestedEffectiveDate) || requestedEffectiveDate < todayIL || requestedEffectiveDate >= departure_date) {
        return fail('INVALID_EFFECTIVE_DATE', 'תאריך תחילת השיבוץ חייב להיות מהיום ולפני עזיבת הקבוצה', dbg);
      }
      arrival_date = requestedEffectiveDate;
    }
    dbg.arrival_date = arrival_date;
    dbg.departure_date = departure_date;
    if (!isValidDate(arrival_date) || !isValidDate(departure_date)) {
      return fail('DATES_INVALID', 'תאריכי השיבוץ אינם תקינים', dbg);
    }
    if (departure_date <= arrival_date) {
      return fail('DATES_DEPARTURE_BEFORE_ARRIVAL', 'תאריך העזיבה חייב להיות אחרי תאריך ההגעה', {
        ...dbg,
        group_id,
        profile_id: operational_group_profile_id,
        groupArrivalRaw,
        groupDepartureRaw,
        profileArrivalRaw,
        profileDepartureRaw,
        finalArrivalBeforeNormalize,
        finalDepartureBeforeNormalize,
        finalArrivalAfterNormalize: arrival_date,
        finalDepartureAfterNormalize: departure_date,
      });
    }

    // ── 5. Conflict check ────────────────────────────────────────────────────

    let existingForTent = [];
    try {
      existingForTent = await base44.asServiceRole.entities.SleepingAllocation.filter({ tent_id });
    } catch (e) {
      console.error('[saveVipSleepingAllocation] SleepingAllocation.filter (tent) error:', e?.message);
    }

    // Only block on OTHER groups — normalize SDK/request IDs at the comparison boundary
    // so this group's physical rows (including one MULTI_PERIOD series) can never self-conflict.
    const currentGroupId = String(group_id);
    const currentAllocationId = allocation_id == null ? null : String(allocation_id);
    const activeForOtherGroups = existingForTent.filter(a =>
      a.status !== 'CANCELLED' &&
      (currentAllocationId == null || String(a.id) !== currentAllocationId) &&
      String(a.group_id) !== currentGroupId
    );
    dbg.existingActiveAllocationsCount = activeForOtherGroups.length;

    const conflicting = activeForOtherGroups.filter(a =>
      datesOverlap(arrival_date, departure_date, a.arrival_date, a.departure_date)
    );
    dbg.conflictingAllocationIds = conflicting.map(a => a.id);

    if (conflicting.length > 0) {
      const conflict = conflicting[0];
      let conflictGroupName = conflict.group_id;
      try {
        const cgs = await base44.asServiceRole.entities.Group.filter({ id: conflict.group_id });
        conflictGroupName = cgs[0]?.group_name || conflict.group_id;
      } catch (_) { /* non-fatal */ }

      return Response.json({
        success: false,
        error: `האוהל כבר משובץ לקבוצה אחרת (${conflictGroupName}) בתאריכים ${conflict.arrival_date} — ${conflict.departure_date}`,
        debug: {
          reasonCode: 'TENT_CONFLICT',
          tent_id,
          tent_code: tent.code,
          conflicting_group_id: conflict.group_id,
          conflicting_allocation_id: conflict.id,
          status: conflict.status,
          dates: { arrival_date: conflict.arrival_date, departure_date: conflict.departure_date },
        },
      }, { status: 200 }); // 200 so SDK doesn't throw; frontend checks success:false
    }

    // ── 6. Check for stale row: same req already on a different tent ─────────

    // Only consider STAFF/VIP allocations for stale-row matching — never touch student rows.
    const staleRow = groupAllocs.find(a =>
      a.status !== 'CANCELLED' &&
      a.id !== allocation_id &&
      a.allocation_type === 'STAFF' &&
      (a.notes || '').includes(noteMarker)
    );
    console.log('[saveVipSleepingAllocation] staleRow:', staleRow ? `id=${staleRow.id} tent=${staleRow.tent_id}` : 'none');
    const rowBeingChanged = allocation_id ? groupAllocs.find(a => String(a.id) === String(allocation_id)) : staleRow;
    if (rowBeingChanged?.status === 'CONFIRMED' && rowBeingChanged.arrival_date <= todayIL && rowBeingChanged.departure_date > todayIL && String(rowBeingChanged.tent_id) !== String(tent_id)) {
      return fail('EFFECTIVE_DATE_REQUIRED', 'שינוי מקום של שיבוץ מאושר פעיל מחייב תאריך תחילה', dbg);
    }

    // ── 7. Build & persist ───────────────────────────────────────────────────

    const cleanNotes = (notes || '').replace(/__vip_req_\d+__\s*/g, '').trim();
    const savePayload = {
      tent_id,
      neighborhood_id:               neighborhood.id,
      group_id,
      operational_group_profile_id,
      arrival_date,
      departure_date,
      allocated_pax:                 pax,
      allocation_type:               'STAFF',
      gender_group,
      notes:                         `${noteMarker}${cleanNotes ? ' ' + cleanNotes : ''}`.trim(),
      status:                        'DRAFT',
    };

    let savedId;
    if (allocation_id) {
      console.log(`[saveVipSleepingAllocation] UPDATE existing allocation_id=${allocation_id}`);
      await base44.asServiceRole.entities.SleepingAllocation.update(allocation_id, savePayload);
      savedId = allocation_id;
      if (staleRow && staleRow.id !== allocation_id) {
        console.log(`[saveVipSleepingAllocation] DELETE stale id=${staleRow.id}`);
        await base44.asServiceRole.entities.SleepingAllocation.delete(staleRow.id);
      }
    } else if (staleRow) {
      console.log(`[saveVipSleepingAllocation] REUSE stale id=${staleRow.id} (tent was ${staleRow.tent_id})`);
      await base44.asServiceRole.entities.SleepingAllocation.update(staleRow.id, savePayload);
      savedId = staleRow.id;
    } else {
      console.log(`[saveVipSleepingAllocation] CREATE new allocation`);
      const created = await base44.asServiceRole.entities.SleepingAllocation.create(savePayload);
      savedId = created.id;
    }

    console.log(`[saveVipSleepingAllocation] SUCCESS: allocation ${savedId} tent ${tent.code}`);

    return Response.json({
      success: true,
      allocation_id: savedId,
      tent_code: tent.code,
      message: `אוהל ${tent.code} שויך בהצלחה`,
    });

  } catch (unexpectedErr) {
    // ── Catches any unhandled exception in the entire function ───────────────
    console.error('[saveVipSleepingAllocation] UNEXPECTED_EXCEPTION:', unexpectedErr?.message, unexpectedErr?.stack);
    return Response.json({
      success: false,
      error: 'שגיאה פנימית בשמירת שיבוץ VIP',
      debug: {
        reasonCode: 'UNEXPECTED_EXCEPTION',
        message:    unexpectedErr?.message,
        stack:      unexpectedErr?.stack,
      },
    }, { status: 500 });
  }
});