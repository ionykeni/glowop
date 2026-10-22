/**
 * submitGuestForm
 * Handles guest form submissions for both:
 *  - Quote-based groups: requires quote_id, validates APPROVED status
 *  - Direct groups:      quote_id is null/absent, validates group exists and is not cancelled
 *
 * After saving the submission, for DAY_USE groups this function also syncs
 * kitchen MealReservation records (meals + coffee corner).
 */
import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { validateDatedOperationalDate } from '../../shared/datedOperationalPeriodValidation.js';
import { loadGuestFormStayPeriods, updateGuestFormStayPeriodTimes } from '../../shared/guestFormStayPeriodTimes.js';

// ── Kitchen sync helpers ─────────────────────────────────────────────────────

// Maps dayUseMeals keys → MealReservation meal_type enum values
const MEAL_KEY_TO_TYPE = {
  breakfast: 'BREAKFAST',
  lunch:     'LUNCH',
  dinner:    'DINNER',
};

// Default durations in minutes per meal type
const MEAL_DURATION = { BREAKFAST: 60, LUNCH: 90, DINNER: 90, COFFEE_CORNER: 60 };

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Default start times for DAY_USE meals (no time provided by guest)
const DEFAULT_TIMES = {
  BREAKFAST:    '08:00',
  LUNCH:        '13:00',
  DINNER:       '18:00',
  COFFEE_CORNER:'10:00',
};

async function syncDayUseKitchen({ base44, group_id, profile_id, activity_date, total_pax, dayUseMeals, coffeeCorner }) {
  // Fetch existing kitchen records for this group created from the external form
  const existing = await base44.asServiceRole.entities.MealReservation.filter({ group_id });
  const fromForm = existing.filter(r => r.source === 'guestForm');

  // Helper: find existing record for a meal type
  const findExisting = (meal_type) => fromForm.find(r => r.meal_type === meal_type && r.status !== 'CANCELLED');

  // ── 1. Sync the three standard meals ────────────────────────────────────────
  for (const [key, meal_type] of Object.entries(MEAL_KEY_TO_TYPE)) {
    const selected = dayUseMeals?.[key] === 'כן';
    const existingRecord = findExisting(meal_type);

    if (selected) {
      const start_time = DEFAULT_TIMES[meal_type];
      const end_time   = addMinutes(start_time, MEAL_DURATION[meal_type]);
      if (existingRecord) {
        // Update pax (and date/times in case they changed)
        await base44.asServiceRole.entities.MealReservation.update(existingRecord.id, {
          pax:        total_pax,
          date:       activity_date,
          start_time,
          end_time,
          status:     'ACTIVE',
        });
      } else {
        // Create new record
        await base44.asServiceRole.entities.MealReservation.create({
          group_id,
          operational_group_profile_id: profile_id || '',
          date:       activity_date,
          meal_type,
          start_time,
          end_time,
          pax:        total_pax,
          source:     'guestForm',
          status:     'ACTIVE',
        });
      }
    } else {
      // Not selected — cancel any existing record from the form
      if (existingRecord) {
        await base44.asServiceRole.entities.MealReservation.update(existingRecord.id, { status: 'CANCELLED' });
      }
    }
  }

  // ── 2. Remove/cancel any sandwich records created by external form ───────────
  const sandwichRecords = fromForm.filter(r =>
    r.meal_type === 'SANDWICH' ||
    (r.notes && r.notes.includes('כריכים'))
  );
  for (const r of sandwichRecords) {
    if (r.status !== 'CANCELLED') {
      await base44.asServiceRole.entities.MealReservation.update(r.id, { status: 'CANCELLED' });
    }
  }

  // ── 3. Coffee Corner is NOT a meal ───────────────────────────────────────────
  // Business rule: Coffee Corner from the guest form must NOT create a
  // MealReservation and must NOT auto-create a CoffeeCornerRequest. It requires
  // manual human handling in the Coffee Corner module. Here we only clean up any
  // legacy COFFEE_CORNER MealReservation previously created by the guest form,
  // so no ghost/orphan kitchen records remain.
  const legacyCoffee = fromForm.filter(r => r.meal_type === 'COFFEE_CORNER' && r.status !== 'CANCELLED');
  for (const r of legacyCoffee) {
    await base44.asServiceRole.entities.MealReservation.update(r.id, { status: 'CANCELLED' });
  }
}

// ── OGP ensure (internal, service-role — never calls the admin-only endpoint) ──
// Guarantees exactly one OperationalGroupProfile for the group.
//   0 → create minimal OGP (accepted_at omitted — auto-ensured, not admin-accepted)
//   1 → reuse
//  >1 → throw MULTIPLE_OPERATIONAL_PROFILES (caller must stop)
async function ensureOgpInternal(base44, group_id, group) {
  const existing = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id });
  if (existing.length > 1) {
    const err = new Error('MULTIPLE_OPERATIONAL_PROFILES');
    err.code = 'MULTIPLE_OPERATIONAL_PROFILES';
    err.profile_ids = existing.map(p => p.id);
    throw err;
  }
  if (existing.length === 1) return existing[0];

  const profileData = { group_id, status: 'ACCEPTED' };
  if (group?.arrival_date)   profileData.arrival_date   = group.arrival_date;
  if (group?.departure_date) profileData.departure_date = group.departure_date;
  if (group?.internal_notes) profileData.general_notes  = group.internal_notes;
  const created = await base44.asServiceRole.entities.OperationalGroupProfile.create(profileData);

  // Post-create duplicate safety check
  const after = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id });
  if (after.length > 1) {
    const err = new Error('MULTIPLE_OPERATIONAL_PROFILES');
    err.code = 'MULTIPLE_OPERATIONAL_PROFILES';
    err.profile_ids = after.map(p => p.id);
    throw err;
  }
  return created;
}

// Maps guest-form submission fields → valid OperationalGroupProfile fields only.
function buildOgpUpdateFromFields(fields, num) {
  const out = {};
  const setNum = (key, val) => { const n = num(val); if (n != null) out[key] = n; };
  setNum('total_pax',           fields.total_pax);
  setNum('participant_count',   fields.participant_count);
  setNum('staff_count',         fields.staff_count);
  setNum('staff_men_count',     fields.staff_men_count);
  setNum('staff_women_count',   fields.staff_women_count);
  setNum('boys_count',          fields.boys_count);
  setNum('girls_count',         fields.girls_count);
  setNum('drivers_men_count',   fields.drivers_men_count);
  setNum('drivers_women_count', fields.drivers_women_count);
  if (fields.is_sleeping_group !== undefined) out.is_sleeping_group = !!fields.is_sleeping_group;
  if (fields.arrival_lunch     !== undefined) out.arrival_lunch     = !!fields.arrival_lunch;
  if (fields.departure_lunch   !== undefined) out.departure_lunch   = !!fields.departure_lunch;
  if (fields.special_diets)            out.special_diets            = fields.special_diets;
  if (fields.meal_plan)                out.meal_plan                = fields.meal_plan;
  if (fields.tent_distribution_notes)  out.tent_distribution_notes  = fields.tent_distribution_notes;
  if (fields.schedule_notes)           out.schedule_requests        = fields.schedule_notes;
  if (fields.general_notes)            out.general_notes            = fields.general_notes;
  return out;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));

    const body = await req.json();
    const { quote_id, group_id, form_link_token, ...fields } = body;

    if (!group_id) {
      return Response.json({ error: 'group_id is required' }, { status: 400 });
    }

    const isDirectGroup = !quote_id;

    if (!isDirectGroup) {
      // ── Quote-based path ────────────────────────────────────────────────────
      let quotes = [];
      try {
        quotes = await base44.asServiceRole.entities.Quote.filter({ id: quote_id });
      } catch {
        return Response.json({ error: 'הטופס לא נמצא — בדקו שהקישור תקין' }, { status: 404 });
      }
      const quote = quotes[0];

      if (!quote) {
        return Response.json({ error: 'הטופס לא נמצא — בדקו שהקישור תקין' }, { status: 404 });
      }

      if (String(quote.status || '').toUpperCase() !== 'APPROVED') {
        return Response.json({ error: 'הצעת המחיר אינה מאושרת — הטופס זמין רק לאחר אישור הצעה' }, { status: 403 });
      }
      if (quote.group_id !== group_id) {
        return Response.json({ error: 'הקישור אינו תואם לקבוצה.' }, { status: 403 });
      }

      // Prevent duplicate submissions (quote-based)
      const existing = await base44.asServiceRole.entities.GuestFormSubmission.filter({ quote_id });
      const locked = existing.find(s => ['SUBMITTED', 'REVIEWED'].includes(s.status));
      if (locked) {
        return Response.json({
          error: 'השאלון כבר נשלח ולא ניתן לערוך אותו. אם יש צורך בשינוי, יש לפנות לצוות בית הדור הבא.'
        }, { status: 409 });
      }
    } else {
      // ── Direct group path ───────────────────────────────────────────────────
      let groups = [];
      try {
        groups = await base44.asServiceRole.entities.Group.filter({ id: group_id });
      } catch {
        return Response.json({ error: 'הקבוצה לא נמצאה — בדקו שהקישור תקין' }, { status: 404 });
      }
      const group = groups[0];
      if (!group) {
        return Response.json({ error: 'הקבוצה לא נמצאה — בדקו שהקישור תקין' }, { status: 404 });
      }
      if (['CANCELLED', 'ARCHIVED'].includes(group.status)) {
        return Response.json({ error: 'הקישור אינו פעיל עוד — פנו לצוות בית הדור הבא' }, { status: 403 });
      }

      // ── Token validation for direct groups ──────────────────────────────────
      const allLinks = await base44.asServiceRole.entities.GroupExternalFormLink.filter({ group_id });
      const hasTokenSystem = allLinks.length > 0;

      if (hasTokenSystem) {
        // Token system is in use — require a valid ACTIVE token
        if (!form_link_token) {
          return Response.json({ error: 'הקישור אינו בתוקף. נא לבקש קישור חדש.' }, { status: 403 });
        }
        const activeLink = allLinks.find(l => l.token === form_link_token && l.status === 'ACTIVE');
        if (!activeLink) {
          return Response.json({ error: 'הקישור אינו בתוקף. נא לבקש קישור חדש.' }, { status: 403 });
        }
        // Prevent double-submission with the same token
        const existingSubs = await base44.asServiceRole.entities.GuestFormSubmission.filter({ group_id });
        const alreadySubmittedWithToken = existingSubs.find(
          s => s.form_link_token === form_link_token && ['SUBMITTED', 'REVIEWED'].includes(s.status)
        );
        if (alreadySubmittedWithToken) {
          return Response.json({
            error: 'הקישור כבר שומש לשליחת הטופס. אם יש צורך בשינוי, בקשו קישור חדש מהצוות.'
          }, { status: 409 });
        }
      }
      // Legacy path (no token system yet): allow submission freely
    }

    const num = (v) => (v !== undefined && v !== null && v !== '' ? Number(v) : null);
    const now = new Date().toISOString();

    console.log('[submitGuestForm]', { group_id, isDirectGroup, quote_id: quote_id || null });

    // ── Ensure exactly one OperationalGroupProfile for this group ─────────────
    // Guests are unauthenticated/token-based, so we NEVER call the admin-only
    // ensureOperationalGroupProfile endpoint — we run the same logic inline.
    let groupForOgp = null;
    try { groupForOgp = await base44.asServiceRole.entities.Group.get(group_id); } catch { /* handled */ }
    if (!groupForOgp) {
      return Response.json({ error: 'GROUP_NOT_FOUND', message: 'הקבוצה לא נמצאה' }, { status: 404 });
    }

    const requestedPeriodTimes = Array.isArray(fields.stay_period_times) ? fields.stay_period_times : [];
    if (groupForOgp.stay_mode === 'MULTI_PERIOD') {
      try {
        const allowedPeriods = await loadGuestFormStayPeriods(base44, group_id, form_link_token);
        const allowedIds = new Set(allowedPeriods.map(period => period.id));
        if (requestedPeriodTimes.some(period => !period?.id || !allowedIds.has(period.id))) {
          return Response.json({ error: 'FOREIGN_STAY_PERIOD' }, { status: 403 });
        }
      } catch {
        return Response.json({ error: 'הקישור אינו בתוקף. נא לבקש קישור חדש.' }, { status: 403 });
      }
    }

    // Validate every dated request before creating or updating any submission data.
    // CONTINUOUS groups pass through unchanged; MULTI_PERIOD groups use ACTIVE periods.
    const datedRows = [];
    try {
      const mealRows = JSON.parse(fields.meal_plan || '[]');
      if (Array.isArray(mealRows)) datedRows.push(...mealRows.map(row => ({ type: 'MEAL', date: row?.date })).filter(row => row.date));
    } catch { /* malformed JSON is handled by existing submission behavior */ }
    try {
      const scheduleRows = JSON.parse(fields.schedule_notes || '[]');
      if (Array.isArray(scheduleRows)) datedRows.push(...scheduleRows.map(row => ({ type: 'ACTIVITY', date: row?.date })).filter(row => row.date));
    } catch { /* malformed JSON is handled by existing submission behavior */ }
    for (const row of datedRows) {
      const dateValidation = await validateDatedOperationalDate(base44, groupForOgp, row.date);
      if (!dateValidation.valid) {
        return Response.json({ error: dateValidation.message, error_code: dateValidation.code, request_type: row.type, date: row.date }, { status: 400 });
      }
    }

    let operational_group_profile_id = '';
    try {
      const ogp = await ensureOgpInternal(base44, group_id, groupForOgp);
      operational_group_profile_id = ogp.id;

      // Update the OGP with operational fields from the submission (source of truth)
      const ogpUpdate = buildOgpUpdateFromFields(fields, num);
      if (Object.keys(ogpUpdate).length > 0) {
        await base44.asServiceRole.entities.OperationalGroupProfile.update(ogp.id, ogpUpdate);
      }
    } catch (ogpErr) {
      if (ogpErr?.code === 'MULTIPLE_OPERATIONAL_PROFILES') {
        console.error('[submitGuestForm] MULTIPLE_OPERATIONAL_PROFILES for group', group_id, ogpErr.profile_ids);
        return Response.json({
          error: 'MULTIPLE_OPERATIONAL_PROFILES',
          message: 'נמצאו מספר פרופילים תפעוליים לקבוצה — נדרשת בדיקת מנהל',
        }, { status: 409 });
      }
      console.error('[submitGuestForm] OGP ensure/update failed:', ogpErr?.message);
      return Response.json({
        error: 'OGP_ENSURE_FAILED',
        message: 'שגיאה ביצירת/עדכון הפרופיל התפעולי — אנא נסו שוב',
      }, { status: 500 });
    }

    // ── Coffee Corner: surface for MANUAL review only (never auto-create) ─────
    // Parse the guest's coffee corner answer (same field for LODGING & DAY_USE).
    let coffeeAnswer = null;
    try { coffeeAnswer = fields.day_use_coffee_corner ? JSON.parse(fields.day_use_coffee_corner) : null; } catch { coffeeAnswer = null; }
    const coffeeRequested = coffeeAnswer?.answer === 'כן';
    if (coffeeRequested && operational_group_profile_id) {
      const COFFEE_NOTE = '☕ יש בקשת פינת קפה בטופס האורח — נדרש טיפול ידני במודול פינת קפה';
      try {
        // Append the note to OGP.general_notes idempotently (no duplicate line on resubmit)
        const ogp = await base44.asServiceRole.entities.OperationalGroupProfile.get(operational_group_profile_id);
        const currentNotes = ogp?.general_notes || '';
        if (!currentNotes.includes('בקשת פינת קפה בטופס האורח')) {
          const newNotes = currentNotes ? `${currentNotes}\n${COFFEE_NOTE}` : COFFEE_NOTE;
          await base44.asServiceRole.entities.OperationalGroupProfile.update(operational_group_profile_id, { general_notes: newNotes });
        }
      } catch (noteErr) {
        console.warn('[submitGuestForm] failed to save coffee note to OGP (non-fatal):', noteErr?.message);
      }
      // Create/refresh a review alert — reuse existing OperationalReviewAlert mechanism
      try {
        const existingAlerts = await base44.asServiceRole.entities.OperationalReviewAlert.filter({
          group_id, source: 'GUEST_FORM_COFFEE_CORNER', status: 'OPEN',
        });
        if (existingAlerts.length === 0) {
          await base44.asServiceRole.entities.OperationalReviewAlert.create({
            group_id,
            module:   'KITCHEN',
            severity: 'WARNING',
            source:   'GUEST_FORM_COFFEE_CORNER',
            title:    'בקשת פינת קפה מהטופס החיצוני',
            message:  'יש בקשת פינת קפה בטופס האורח — נדרש טיפול ידני במודול פינת קפה.',
            status:   'OPEN',
          });
        }
      } catch (alertErr) {
        console.warn('[submitGuestForm] failed to create coffee review alert (non-fatal):', alertErr?.message);
      }
    }

    // Resolve token version number if present
    let form_link_version = null;
    if (form_link_token && isDirectGroup) {
      try {
        const links = await base44.asServiceRole.entities.GroupExternalFormLink.filter({ group_id });
        const matchedLink = links.find(l => l.token === form_link_token);
        if (matchedLink) form_link_version = matchedLink.version_number;
      } catch { /* non-fatal */ }
    }

    const submissionData = {
      group_id,
      ...(isDirectGroup ? {} : { quote_id }),
      ...(form_link_token ? { form_link_token, form_link_version } : {}),
      contact_name:            fields.contact_name              || '',
      contact_phone:           fields.contact_phone             || '',
      contact_email:           fields.contact_email             || '',
      client_org:              fields.client_org                || '',
      group_type_label:        fields.group_type_label          || '',
      estimated_arrival_time:  fields.estimated_arrival_time    || null,
      estimated_departure_time: fields.estimated_departure_time || null,
      total_pax:               num(fields.total_pax),
      staff_count:             num(fields.staff_count),
      participant_count:       num(fields.participant_count),
      boys_count:              num(fields.boys_count),
      girls_count:             num(fields.girls_count),
      staff_men_count:         num(fields.staff_men_count),
      staff_women_count:       num(fields.staff_women_count),
      drivers_men_count:       num(fields.drivers_men_count),
      drivers_women_count:     num(fields.drivers_women_count),
      is_sleeping_group:       !!fields.is_sleeping_group,
      arrival_lunch:           !!fields.arrival_lunch,
      departure_lunch:         !!fields.departure_lunch,
      special_diets:           fields.special_diets             || '{}',
      meal_plan:               fields.meal_plan                 || '[]',
      tent_distribution_notes: fields.tent_distribution_notes   || '{}',
      schedule_notes:          fields.schedule_notes            || '[]',
      general_notes:           fields.general_notes             || '',
      submitted_at: now,
      source:       'LINK',
      status:       'SUBMITTED',
    };

    console.log('[submitGuestForm] creating submission...');
    const submission = await base44.asServiceRole.entities.GuestFormSubmission.create(submissionData);

    if (groupForOgp.stay_mode === 'MULTI_PERIOD') {
      await updateGuestFormStayPeriodTimes(base44, group_id, form_link_token, requestedPeriodTimes);
    }

    // ── DAY_USE kitchen sync ─────────────────────────────────────────────────
    // Fetch group to check type and get activity date
    let groupForSync = null;
    try {
      const groups = await base44.asServiceRole.entities.Group.filter({ id: group_id });
      groupForSync = groups[0] || null;
    } catch { /* non-fatal */ }

    if (groupForSync?.group_type === 'DAY_USE') {
      const activity_date = groupForSync.arrival_date;
      // Prefer the edited form pax; if empty, fall back to the current OGP value
      // (already updated above) so meals never get pax 0 when a valid number exists.
      const formPax = num(fields.total_pax);
      let total_pax = formPax != null ? formPax : 0;
      if (formPax == null && operational_group_profile_id) {
        try {
          const ogpNow = await base44.asServiceRole.entities.OperationalGroupProfile.get(operational_group_profile_id);
          if (ogpNow?.total_pax != null) total_pax = ogpNow.total_pax;
        } catch { /* keep 0 fallback */ }
      }

      // Parse DAY_USE meal selections
      let dayUseMeals = {};
      try { dayUseMeals = JSON.parse(fields.meal_plan || '{}'); } catch { dayUseMeals = {}; }

      // Parse coffee corner
      let coffeeCorner = null;
      try { coffeeCorner = fields.day_use_coffee_corner ? JSON.parse(fields.day_use_coffee_corner) : null; } catch { coffeeCorner = null; }

      // Use the OGP id ensured at the start of this request (never stale/empty)
      const profile_id = operational_group_profile_id;

      // Meals must be created whenever a meal is selected — even if the DAY_USE
      // form did not collect a participant breakdown (pax may legitimately be 0/null).
      // Only activity_date is truly required; pax defaults to 0 and can be filled later.
      if (activity_date) {
        try {
          await syncDayUseKitchen({ base44, group_id, profile_id, activity_date, total_pax, dayUseMeals, coffeeCorner });
          console.log('[submitGuestForm] DAY_USE kitchen sync complete');
        } catch (syncErr) {
          console.warn('[submitGuestForm] kitchen sync failed (non-fatal):', syncErr?.message);
        }
      } else {
        console.warn('[submitGuestForm] skipping kitchen sync — missing activity_date', { activity_date, total_pax });
      }
    }

    // ── Cancel out-of-range meals for this group ─────────────────────────────
    // When form is resubmitted after group dates changed, stale meals outside
    // the new date range must be cancelled (not deleted).
    if (groupForSync) {
      try {
        const allMeals = await base44.asServiceRole.entities.MealReservation.filter({ group_id });
        const arrival   = groupForSync.arrival_date;
        const departure = groupForSync.departure_date;
        const toCancel  = allMeals.filter(m => {
          if (m.status === 'CANCELLED') return false;
          if (arrival   && m.date < arrival)   return true;
          if (departure && m.date > departure) return true;
          return false;
        });
        for (const m of toCancel) {
          await base44.asServiceRole.entities.MealReservation.update(m.id, { status: 'CANCELLED' });
        }
        if (toCancel.length > 0) {
          console.log(`[submitGuestForm] cancelled ${toCancel.length} out-of-range meals`);
        }
      } catch (cancelErr) {
        console.warn('[submitGuestForm] out-of-range meal cancel failed (non-fatal):', cancelErr?.message);
      }
    }

    // ── Sync arrival/departure times to Group ────────────────────────────────
    // The guest form is the operational truth for times — always update the group
    const arrivalTime   = fields.estimated_arrival_time   || null;
    const departureTime = fields.estimated_departure_time || null;
    if (arrivalTime || departureTime) {
      try {
        const timeUpdate = {};
        if (arrivalTime)   timeUpdate.arrival_time   = arrivalTime;
        if (departureTime) timeUpdate.departure_time = departureTime;
        await base44.asServiceRole.entities.Group.update(group_id, timeUpdate);
        console.log('[submitGuestForm] synced arrival/departure times to Group:', timeUpdate);
      } catch (timeErr) {
        console.warn('[submitGuestForm] failed to sync times to Group (non-fatal):', timeErr?.message);
      }
    }

    // ── Create review alert so admin sees the new submission ─────────────────
    try {
      await base44.asServiceRole.entities.OperationalReviewAlert.create({
        group_id,
        module:   'GROUP',
        severity: 'WARNING',
        source:   'GUEST_FORM_SUBMITTED',
        title:    'נתונים חדשים התקבלו מהטופס החיצוני',
        message:  'התקבלו נתונים חדשים מהטופס החיצוני עבור הקבוצה. יש לבדוק את הנתונים לפני סנכרון.',
        status:   'OPEN',
        new_value_json: JSON.stringify({ submission_id: submission.id, submitted_at: now }),
      });
    } catch (alertErr) {
      console.warn('[submitGuestForm] failed to create review alert:', alertErr?.message);
    }

    return Response.json({ success: true, submission_id: submission.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}