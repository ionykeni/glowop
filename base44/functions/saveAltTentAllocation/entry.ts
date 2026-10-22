import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { assertOperationalGroup } from '../../shared/quotePreparationConfig.js';

/**
 * Saves an "alternative tent" allocation for staff overflow.
 * This is a regular (non-VIP) tent used when VIP tents are exhausted.
 *
 * Marker in notes: __alt_tent__
 * allocation_type: STAFF  (same as VIP rows — distinguishable via __alt_tent__ marker)
 *
 * Overlap rule: arrival_date inclusive, departure_date exclusive.
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
  console.error(`[saveAltTentAllocation] FAIL: ${reasonCode} — ${errorMsg}`, JSON.stringify(dbg));
  return Response.json({ success: false, error: errorMsg, debug: { reasonCode, ...dbg } }, { status: 200 });
}

const ALT_TENT_MARKER = '__alt_tent__';

Deno.serve(async (req) => {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));

    let user = null;
    try {
      user = await base44.auth.me();
    } catch (authErr) {
      console.warn('[saveAltTentAllocation] auth.me() threw (non-fatal):', authErr?.message);
    }
    if (!user) {
      console.warn('[saveAltTentAllocation] no authenticated user — proceeding with service role only');
    } else {
      console.log(`[saveAltTentAllocation] user: ${user.email} role: ${user.role}`);
    }

    let body;
    try {
      body = await req.json();
    } catch (parseErr) {
      return Response.json({ success: false, error: 'חסרים פרטי שיבוץ', debug: { reasonCode: 'BODY_PARSE_ERROR', message: parseErr?.message } }, { status: 400 });
    }

    const {
      allocation_id,           // string | null — if editing an existing row
      group_id,
      operational_group_profile_id,
      tent_id,
      gender_group,            // MEN | WOMEN | MIXED
      allocated_pax,
      notes,
    } = body;

    const dbg = { group_id, operational_group_profile_id, tent_id, gender_group, allocated_pax, allocation_id };

    // ── 1. Input validation ─────────────────────────────────────────────────
    if (!group_id || !operational_group_profile_id || !tent_id) {
      return fail('MISSING_INPUT', 'חסרים פרטי שיבוץ', dbg);
    }
    if (!gender_group || !['MEN', 'WOMEN', 'MIXED'].includes(gender_group)) {
      return fail('INVALID_GENDER', 'יש לבחור מגדר', dbg);
    }
    const pax = Number(allocated_pax);
    if (!pax || pax < 1) {
      return fail('INVALID_PAX', 'יש להזין מספר אנשים לאוהל חילופי', dbg);
    }

    // ── 2. Load & validate tent ─────────────────────────────────────────────
    const tents = await base44.asServiceRole.entities.Tent.filter({ id: tent_id });
    const tent  = tents[0] || null;
    if (!tent) return fail('TENT_NOT_FOUND', 'האוהל לא נמצא במערכת', dbg);

    dbg.tent_code    = tent.code;
    dbg.tent_type    = tent.tent_type;
    dbg.tent_capacity = tent.capacity;

    // Alternative tent must NOT be a VIP tent
    if (tent.tent_type === 'VIP') {
      return fail('TENT_IS_VIP', 'אוהל חילופי חייב להיות אוהל רגיל, לא VIP', dbg);
    }
    if (tent.working_status !== 'WORKING') {
      return fail('TENT_NOT_WORKING', 'האוהל אינו זמין לשימוש', dbg);
    }

    // For alternative (regular) tents: enforce real capacity
    if (pax > (tent.capacity || 999)) {
      return fail('PAX_EXCEEDS_CAPACITY', 'מספר האנשים גדול מקיבולת האוהל', dbg);
    }

    // ── 3. Load neighborhood ────────────────────────────────────────────────
    const hoods        = await base44.asServiceRole.entities.Neighborhood.filter({ id: tent.neighborhood_id });
    const neighborhood = hoods[0] || null;
    if (!neighborhood) return fail('NEIGHBORHOOD_NOT_FOUND', 'שכונת האוהל לא נמצאה', dbg);

    // ── 4. Load profile → dates ─────────────────────────────────────────────
    const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ id: operational_group_profile_id });
    const profile  = profiles[0] || null;
    if (!profile || profile.group_id !== group_id) {
      return fail('PROFILE_NOT_FOUND', 'חסרים פרטי קבוצה או פרופיל תפעולי', dbg);
    }

    // ── Load Group for authoritative dates (Group is source of truth) ──────────
    let group = null;
    try {
      const groups = await base44.asServiceRole.entities.Group.filter({ id: group_id });
      group = groups[0] || null;
    } catch (e) {
      console.error('[saveAltTentAllocation] Group.filter error:', e?.message);
    }
    try { assertOperationalGroup(group); } catch (error) { return fail(error.code, 'הקבוצה עדיין אינה פעילה תפעולית', dbg); }

    const groupArrivalRaw   = group?.arrival_date   || group?.check_in_date  || group?.start_date  || null;
    const groupDepartureRaw = group?.departure_date || group?.check_out_date || group?.end_date    || null;
    const profileArrivalRaw   = profile.arrival_date   || profile.check_in_date  || profile.start_date  || null;
    const profileDepartureRaw = profile.departure_date || profile.check_out_date || profile.end_date    || null;

    // Group dates preferred; profile dates only as fallback
    let arrival_date   = groupArrivalRaw   || profileArrivalRaw   || null;
    let departure_date = groupDepartureRaw || profileDepartureRaw || null;

    if (!arrival_date || !departure_date) return fail('DATES_MISSING', 'חסרים תאריכי הגעה/עזיבה', dbg);
    // Normalize to date-only (YYYY-MM-DD) — fields may contain ISO timestamps
    const finalArrivalBeforeNormalize   = arrival_date;
    const finalDepartureBeforeNormalize = departure_date;
    arrival_date   = String(arrival_date).slice(0, 10);
    departure_date = String(departure_date).slice(0, 10);
    if (!isValidDate(arrival_date) || !isValidDate(departure_date)) return fail('DATES_INVALID', 'תאריכי השיבוץ אינם תקינים', dbg);
    if (departure_date <= arrival_date) return fail('DATES_ORDER', 'תאריך עזיבה חייב להיות אחרי תאריך הגעה', {
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

    dbg.arrival_date   = arrival_date;
    dbg.departure_date = departure_date;
    const currentAllocation = allocation_id
      ? (await base44.asServiceRole.entities.SleepingAllocation.filter({ id: allocation_id }))[0] || null
      : null;
    const todayIL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    if (currentAllocation?.status === 'CONFIRMED' && currentAllocation.arrival_date <= todayIL && currentAllocation.departure_date > todayIL && String(currentAllocation.tent_id) !== String(tent_id)) {
      return fail('EFFECTIVE_DATE_REQUIRED', 'שינוי מקום של שיבוץ מאושר פעיל מחייב תאריך תחילה', dbg);
    }

    // ── 5. Conflict check — any group including same group ──────────────────
    // Exception: skip the allocation row being updated (allocation_id).
    // Exception: ignore allocations that already ended (departure_date <= today) —
    // guests who already left do not block new allocations going forward.
    const allForTent = await base44.asServiceRole.entities.SleepingAllocation.filter({ tent_id });
    const conflicting = allForTent.filter(a =>
      a.status !== 'CANCELLED' &&
      a.id !== allocation_id &&
      a.departure_date > todayIL &&
      datesOverlap(arrival_date, departure_date, a.arrival_date, a.departure_date)
    );

    if (conflicting.length > 0) {
      return fail('TENT_CONFLICT', 'האוהל כבר משובץ בתאריכים אלו', dbg);
    }

    // ── 6. Build & persist ─────────────────────────────────────────────────
    const cleanNotes  = (notes || '').replace(/__alt_tent__\s*/g, '').trim();
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
      notes:                         `${ALT_TENT_MARKER}${cleanNotes ? ' ' + cleanNotes : ''}`.trim(),
      status:                        'DRAFT',
    };

    let savedId;
    if (allocation_id) {
      // Editing an existing alt tent row
      await base44.asServiceRole.entities.SleepingAllocation.update(allocation_id, savePayload);
      savedId = allocation_id;
    } else {
      // Creating a new alt tent row (multiple per group allowed)
      const created = await base44.asServiceRole.entities.SleepingAllocation.create(savePayload);
      savedId = created.id;
    }

    console.log(`[saveAltTentAllocation] SUCCESS: allocation ${savedId} tent ${tent.code}`);
    return Response.json({ success: true, allocation_id: savedId, tent_code: tent.code, message: `אוהל ${tent.code} שויך בהצלחה כאוהל חילופי` });

  } catch (unexpectedErr) {
    console.error('[saveAltTentAllocation] UNEXPECTED_EXCEPTION:', unexpectedErr?.message, unexpectedErr?.stack);
    return Response.json({ success: false, error: 'שגיאה פנימית בשמירת אוהל חילופי', debug: { reasonCode: 'UNEXPECTED_EXCEPTION', message: unexpectedErr?.message } }, { status: 500 });
  }
});