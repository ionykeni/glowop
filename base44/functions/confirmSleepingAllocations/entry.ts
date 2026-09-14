import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { assertOperationalGroup } from '../../shared/quotePreparationConfig.js';
import { assertSleepingAccess, readSleepingRows, sleepingToday } from '../../shared/sleepingActionCore.js';
import { groupLogicalSleepingAssignments, validateLinkedSeriesCompleteness } from '../../shared/logicalSleepingSeries.js';

const RUNTIME_BUILD = 'MP_CONFIRM_CURRENT_SOURCE_2026_09_14';
const responseJson = (body, init) => responseJson({ ...body, runtime_build: RUNTIME_BUILD }, init);

function datesOverlap(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}

// Preserve the established VIP operational override; standard tents use physical capacity.
function getOperationalMaxPax(tent) {
  return tent.tent_type === 'VIP' || tent.is_accessible === true || /^8\d/.test(String(tent.code || ''))
    ? 4
    : (tent.capacity || 8);
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch (authErr) {
      console.warn('[confirmSleepingAllocations] auth.me() threw (non-fatal):', authErr?.message);
    }

    if (!user) {
      console.warn('[confirmSleepingAllocations] no authenticated user — proceeding with service role only');
    } else {
      console.log(`[confirmSleepingAllocations] user: ${user.email} role: ${user.role}`);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return responseJson({ success: false, error: 'בקשה לא תקינה — JSON שגוי' }, { status: 200 });
    }

    const { group_id, draft_allocation_ids, shared_neighborhood_allowed, shared_neighborhood_reason } = body;

    console.log('[confirmSleepingAllocations] group_id:', group_id);
    console.log('[confirmSleepingAllocations] draft_allocation_ids:', JSON.stringify(draft_allocation_ids));
    console.log('[confirmSleepingAllocations] shared_neighborhood_allowed:', shared_neighborhood_allowed);

    if (!group_id) {
      return responseJson({ success: false, error: 'חסר group_id', debug: { reasonCode: 'NO_GROUP_ID' } }, { status: 200 });
    }
    // Validate: if shared override requested, reason is mandatory
    if (shared_neighborhood_allowed && !shared_neighborhood_reason?.trim()) {
      return responseJson({
        success: false,
        error: 'יש לספק סיבה לאישור שכונה משותפת',
        debug: { reasonCode: 'SHARED_REASON_MISSING' }
      }, { status: 200 });
    }

    const group = await base44.asServiceRole.entities.Group.get(group_id).catch(() => null);
    try { assertOperationalGroup(group); } catch (error) { return responseJson({ success: false, error: error.code }, { status: 409 }); }

    // ── 1. Load ALL draft allocations for this group from DB (source of truth) ─
    // We do NOT rely solely on frontend-supplied IDs — the frontend cache may be
    // stale and miss VIP / alt-tent rows saved in the same session.
    if (group?.stay_mode === 'MULTI_PERIOD') await assertSleepingAccess(base44, user);
    const allGroupAllocations = group?.stay_mode === 'MULTI_PERIOD'
      ? await readSleepingRows(base44.asServiceRole.entities.SleepingAllocation, { group_id })
      : await base44.asServiceRole.entities.SleepingAllocation.filter({ group_id });
    const activePeriods = group?.stay_mode === 'MULTI_PERIOD'
      ? await base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id, status: 'ACTIVE' }, 'start_date', 100)
      : [];
    const seriesValidation = group?.stay_mode === 'MULTI_PERIOD'
      ? validateLinkedSeriesCompleteness(allGroupAllocations, activePeriods, group_id)
      : { linked: false, valid: true, errors: [], ...groupLogicalSleepingAssignments(allGroupAllocations) };

    if (!seriesValidation.valid) {
      return responseJson({
        success: false,
        error: 'שיבוץ רב-תקופתי אינו שלם או אינו עקבי',
        debug: { reasonCode: 'INVALID_MULTI_PERIOD_SERIES', series_errors: seriesValidation.errors },
      }, { status: 200 });
    }

    const finalDraftsToConfirm = allGroupAllocations.filter(a => a.status === 'DRAFT' && (group?.stay_mode !== 'MULTI_PERIOD' || a.departure_date > sleepingToday()));
    console.log(`[confirmSleepingAllocations] total group drafts found in DB: ${finalDraftsToConfirm.length}`);
    console.log(`[confirmSleepingAllocations] frontend requested IDs: ${draft_allocation_ids?.length ?? 0}`);

    if (finalDraftsToConfirm.length === 0) {
      const alreadyConfirmed = seriesValidation.linked && seriesValidation.logical_assignments.length > 0 && seriesValidation.logical_assignments.every(item => item.all_confirmed);
      if (alreadyConfirmed) {
        return responseJson({
          success: true,
          already_confirmed: true,
          confirmed_count: 0,
          logical_assignment_count: seriesValidation.logical_assignment_count,
          physical_row_count: seriesValidation.physical_row_count,
          message: 'שיבוץ הלינה כבר אושר',
        });
      }
      return responseJson({
        success: false,
        error: 'לא נמצאו שיבוצי טיוטה לאישור — ייתכן שכבר אושרו או בוטלו',
        debug: {
          reasonCode: 'NO_DRAFTS_FOUND',
          all_statuses: allGroupAllocations.map(a => ({ id: a.id, status: a.status, type: a.allocation_type }))
        }
      }, { status: 200 });
    }

    // ── 2. Load other groups' allocations for conflict checking ──────────────
    const allConfirmed = await base44.asServiceRole.entities.SleepingAllocation.filter({ status: 'CONFIRMED' });
    const allDrafts    = await base44.asServiceRole.entities.SleepingAllocation.filter({ status: 'DRAFT' });
    const finalDraftIds = new Set(finalDraftsToConfirm.map(d => d.id));
    // Stays that already ended (departure_date <= today, exclusive) no longer block anything
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const otherActive  = [...allConfirmed, ...allDrafts].filter(a =>
      a.group_id !== group_id && !finalDraftIds.has(a.id) && a.departure_date > today
    );

    // ── 3. Load neighborhoods and tents ──────────────────────────────────────
    const neighborhoods = await base44.asServiceRole.entities.Neighborhood.list();
    const neighborhoodMap = Object.fromEntries(neighborhoods.map(n => [n.id, n]));

    const tents = await base44.asServiceRole.entities.Tent.list();
    const tentMap = Object.fromEntries(tents.map(t => [t.id, t]));

    // ── 4. Load neighborhood reservations for shared override check ──────────
    // Check if the current group already has shared_neighborhood_allowed on any active reservation
    const myNhoodReservations = await base44.asServiceRole.entities.NeighborhoodReservation.filter({ group_id, status: 'ACTIVE' });
    const sharedNhoodIds = new Set(
      myNhoodReservations
        .filter(r => r.shared_neighborhood_allowed === true)
        .map(r => r.neighborhood_id)
    );

    // ── 5. Validate each draft ────────────────────────────────────────────────
    const errors = [];
    const neighborhoodConflictBlocked = []; // track nhood conflicts that need shared override

    for (const draft of finalDraftsToConfirm) {
      const tent = tentMap[draft.tent_id];
      if (!tent) {
        errors.push(`שיבוץ לינה לא נמצא — אוהל חסר (id: ${draft.tent_id})`);
        continue;
      }
      const neighborhood = neighborhoodMap[draft.neighborhood_id];
      const isVip = neighborhood?.is_vip === true;

      // Rule 1: capacity
      const operationalMax = getOperationalMaxPax(tent);
      if (draft.allocated_pax > operationalMax) {
        errors.push(`אוהל ${tent.code}: כמות האנשים (${draft.allocated_pax}) גדולה מהמקסימום התפעולי (${operationalMax}).`);
      }

      // Rule 2: EXACT TENT exclusivity — ALWAYS hard-blocked, even with shared override
      const tentConflicts = otherActive.filter(o =>
        o.tent_id === draft.tent_id &&
        datesOverlap(draft.arrival_date, draft.departure_date, o.arrival_date, o.departure_date)
      );
      if (tentConflicts.length > 0) {
        errors.push(`לא ניתן לשבץ את אותו אוהל לשתי קבוצות באותם תאריכים. (אוהל ${tent.code})`);
      }

      // Linked rows in the same series are intentional across non-overlapping periods.
      // A different linked series in this group may not overlap on the same exact tent.
      const sameGroupTentConflicts = allGroupAllocations.filter(other =>
        other.status !== 'CANCELLED' &&
        other.departure_date > today &&
        other.id !== draft.id &&
        other.tent_id === draft.tent_id &&
        datesOverlap(draft.arrival_date, draft.departure_date, other.arrival_date, other.departure_date) &&
        draft.allocation_series_id &&
        other.allocation_series_id
      );
      if (sameGroupTentConflicts.some(other => other.allocation_series_id !== draft.allocation_series_id)) {
        errors.push(`אוהל ${tent.code}: שתי סדרות שיבוץ של אותה קבוצה חופפות באותם תאריכים.`);
      }
      if (sameGroupTentConflicts.some(other => other.allocation_series_id === draft.allocation_series_id)) {
        errors.push(`אוהל ${tent.code}: תקופות באותה סדרת שיבוץ חופפות זו לזו.`);
      }

      // Rule 3: student neighborhood exclusivity (non-VIP only)
      // Bypassed if: shared_neighborhood_allowed is true (passed in request) OR already stored on reservation
      if (draft.allocation_type === 'STUDENT' && !isVip) {
        const nhoodConflicts = otherActive.filter(o =>
          o.allocation_type === 'STUDENT' &&
          o.neighborhood_id === draft.neighborhood_id &&
          datesOverlap(draft.arrival_date, draft.departure_date, o.arrival_date, o.departure_date)
        );
        if (nhoodConflicts.length > 0) {
          const isSharedAllowed = shared_neighborhood_allowed || sharedNhoodIds.has(draft.neighborhood_id);
          if (!isSharedAllowed) {
            neighborhoodConflictBlocked.push(neighborhood?.name || draft.neighborhood_id);
            errors.push(`שכונה "${neighborhood?.name || draft.neighborhood_id}": כבר תפוסה על ידי קבוצת חניכים אחרת בתאריכים אלו.`);
          }
          // If shared allowed — pass through (tent check above still guards)
        }
      }

      // Rule 4: no mixed-gender occupancy in the same tent during overlapping dates
      const genderConflict = allGroupAllocations.some(other =>
        other.status !== 'CANCELLED' &&
        other.departure_date > today &&
        other.id !== draft.id &&
        other.tent_id === draft.tent_id &&
        other.gender_group !== draft.gender_group &&
        datesOverlap(draft.arrival_date, draft.departure_date, other.arrival_date, other.departure_date)
      );
      if (genderConflict) {
        errors.push(`אוהל ${tent.code}: לא ניתן לשבץ שני מגדרים שונים לאותו אוהל.`);
      }
    }

    const uniqueErrors = [...new Set(errors)];
    if (uniqueErrors.length > 0) {
      console.warn('[confirmSleepingAllocations] validation errors:', uniqueErrors);
      const needsSharedOverride = neighborhoodConflictBlocked.length > 0 && !uniqueErrors.some(e => e.includes('לא ניתן לשבץ את אותו אוהל'));
      return responseJson({
        success: false,
        errors: uniqueErrors,
        needs_shared_override: needsSharedOverride,
        blocked_neighborhoods: [...new Set(neighborhoodConflictBlocked)],
      }, { status: 200 });
    }

    // ── 6. If shared override was used, update the neighborhood reservation ──
    if (shared_neighborhood_allowed && shared_neighborhood_reason?.trim()) {
      const now = new Date().toISOString();
      const approvedBy = user?.email || 'unknown';

      // Update all matching active NhoodReservations for this group that are in a shared context
      const nhoodIdsInBatch = new Set(finalDraftsToConfirm.map(d => d.neighborhood_id));
      for (const nhoodId of nhoodIdsInBatch) {
        const matchingReservations = myNhoodReservations.filter(r => r.neighborhood_id === nhoodId && (group?.stay_mode !== 'MULTI_PERIOD' || r.departure_date > today));
        await Promise.all(matchingReservations.map(res =>
          base44.asServiceRole.entities.NeighborhoodReservation.update(res.id, {
            shared_neighborhood_allowed: true,
            shared_neighborhood_reason: shared_neighborhood_reason.trim(),
            shared_neighborhood_approved_by: approvedBy,
            shared_neighborhood_approved_at: now,
          })
        ));
      }
      console.log(`[confirmSleepingAllocations] shared override recorded by ${approvedBy} for neighborhoods: ${[...nhoodIdsInBatch].join(', ')}`);
    }

    // ── 7. Confirm all drafts ─────────────────────────────────────────────────
    await Promise.all(
      finalDraftsToConfirm.map(draft =>
        base44.asServiceRole.entities.SleepingAllocation.update(draft.id, { status: 'CONFIRMED' })
      )
    );

    const confirmedIds = finalDraftsToConfirm.map(d => d.id);
    console.log('[confirmSleepingAllocations] confirmed IDs:', confirmedIds);

    const confirmedLogical = groupLogicalSleepingAssignments(allGroupAllocations.map(row =>
      finalDraftIds.has(row.id) ? { ...row, status: 'CONFIRMED' } : row
    ));
    const typeBreakdown = {
      student: finalDraftsToConfirm.filter(d => d.allocation_type === 'STUDENT').length,
      staff:   finalDraftsToConfirm.filter(d => d.allocation_type === 'STAFF').length,
    };
    console.log('[confirmSleepingAllocations] breakdown:', typeBreakdown);

    return responseJson({
      success: true,
      confirmed_count: finalDraftsToConfirm.length,
      confirmed_ids: confirmedIds,
      logical_assignment_count: confirmedLogical.logical_assignment_count,
      physical_row_count: confirmedLogical.physical_row_count,
      logical_allocated_pax: confirmedLogical.logical_assignments.reduce((sum, item) => sum + (item.logical_allocated_pax || 0), 0),
      type_breakdown: typeBreakdown,
      message: 'שיבוץ הלינה אושר',
      shared_override_used: !!(shared_neighborhood_allowed && shared_neighborhood_reason),
    });

  } catch (err) {
    console.error('[confirmSleepingAllocations] unexpected error:', err?.message, err?.stack);
    return responseJson({
      success: false,
      error: 'שגיאה פנימית באישור שיבוץ לינה',
      debug: { reasonCode: 'UNEXPECTED_EXCEPTION', message: err?.message }
    }, { status: 500 });
  }
}