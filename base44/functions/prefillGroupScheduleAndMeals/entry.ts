/**
 * Called explicitly by admin ("סנכרן") when OperationalGroupProfile is accepted.
 * Creates groupSync rows for schedule and meals from GuestFormSubmission data.
 * Idempotent: updates existing groupSync rows, never touches manual rows.
 * Supports partial sync (no GuestFormSubmission) — syncs from Group + OperationalGroupProfile alone.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { assertOperationalGroup } from '../../shared/quotePreparationConfig.js';
import { validateDatedOperationalDate } from '../../shared/datedOperationalPeriodValidation.js';

import { MEAL_DEFAULTS } from '../../shared/mealDefaults.js';

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function buildDietSummary(diets) {
  if (!diets || typeof diets !== 'object') return '';
  const labels = [
    { key: 'vegetarian_count',      label: 'צמחוני' },
    { key: 'vegan_count',           label: 'טבעוני' },
    { key: 'glutenFree_count',      label: 'ללא גלוטן' },
    { key: 'lactoseFree_count',     label: 'ללא לקטוז' },
    { key: 'eggFree_count',         label: 'ללא ביצים' },
    { key: 'nutFree_count',         label: 'ללא אגוזים' },
    { key: 'mehadrinKosher_count',  label: 'מהדרין' },
    { key: 'lifeThreatening_count', label: 'אלרגיה מסכנת חיים' },
  ];
  const parts = labels
    .filter(l => Number(diets[l.key]) > 0)
    .map(l => `${l.label}: ${diets[l.key]}`);
  if (diets.diet_notes) parts.push(`הערות: ${diets.diet_notes}`);
  return parts.join(' | ');
}

Deno.serve(async (req) => {
  console.log('[prefillGroupScheduleAndMeals] function invoked');
  const base44 = createClientFromRequest(req);
  let step = 'init';

  try {
    step = 'parse_body';
    const { operational_group_profile_id } = await req.json();
    if (!operational_group_profile_id) {
      return Response.json({ success: false, error: 'operational_group_profile_id is required' }, { status: 400 });
    }
    console.log('[prefillGroupScheduleAndMeals] profile_id:', operational_group_profile_id);

    // Load the profile
    step = 'load_profile';
    const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({
      id: operational_group_profile_id,
    });
    const profile = profiles[0];
    if (!profile) return Response.json({ success: false, error: 'Profile not found' }, { status: 404 });

    const group_id = profile.group_id;

    // Load group for date range validation
    step = 'load_group';
    const groupRecords = await base44.asServiceRole.entities.Group.filter({ id: group_id });
    const group = groupRecords[0] || null;
    try { assertOperationalGroup(group); } catch (error) { return Response.json({ success: false, error: error.code }, { status: 409 }); }
    console.log('[prefillGroupScheduleAndMeals] group_id:', group_id);

    // Try to load GuestFormSubmission — NOT required
    step = 'load_submission';
    let submission = null;
    if (profile.guest_form_submission_id) {
      const submissions = await base44.asServiceRole.entities.GuestFormSubmission.filter({
        id: profile.guest_form_submission_id,
      });
      submission = submissions[0] || null;
    }
    // Also try by group_id if not found via profile link
    if (!submission) {
      const byGroup = await base44.asServiceRole.entities.GuestFormSubmission.filter({ group_id });
      // Prefer REVIEWED, then SUBMITTED, then any
      submission = byGroup.find(s => s.status === 'REVIEWED')
        || byGroup.find(s => s.status === 'SUBMITTED')
        || byGroup[0]
        || null;
    }
    console.log('[prefillGroupScheduleAndMeals] submission found:', !!submission);

    // Load existing groupSync rows for upsert
    step = 'load_existing';
    const [existingSchedule, existingGroupSyncMeals, allGroupMeals] = await Promise.all([
      base44.asServiceRole.entities.GroupScheduleItem.filter({
        operational_group_profile_id,
        source: 'groupSync',
      }),
      base44.asServiceRole.entities.MealReservation.filter({
        operational_group_profile_id,
        source: 'groupSync',
      }),
      // Load ALL active meals for this group to detect manual conflicts
      base44.asServiceRole.entities.MealReservation.filter({
        group_id,
      }),
    ]);

    const scheduleByKey = {};
    existingSchedule.forEach(item => {
      const key = `${item.date}|${item.start_time}|${item.activity_name}`;
      scheduleByKey[key] = item;
    });

    // ── Step 0: Clean up any pre-existing duplicates for this group ─────────
    // Group all active meals by date|meal_type; if >1 exists, cancel extras.
    const activeMealsAll = allGroupMeals.filter(m => m.status !== 'CANCELLED');
    const mealsByKey = {};
    for (const m of activeMealsAll) {
      const key = `${m.date}|${m.meal_type}`;
      if (!mealsByKey[key]) mealsByKey[key] = [];
      mealsByKey[key].push(m);
    }
    for (const [key, rows] of Object.entries(mealsByKey)) {
      if (rows.length <= 1) continue;
      // Keep: prefer manual source, then oldest (smallest created_date / id)
      const sorted = [...rows].sort((a, b) => {
        if (a.source === 'manual' && b.source !== 'manual') return -1;
        if (b.source === 'manual' && a.source !== 'manual') return 1;
        return (a.created_date || a.id) < (b.created_date || b.id) ? -1 : 1;
      });
      const [keep, ...dupes] = sorted;
      console.log(`[prefillGroupScheduleAndMeals] dedup ${key}: keeping ${keep.id} (${keep.source}), cancelling ${dupes.map(d=>d.id)}`);
      for (const dupe of dupes) {
        await base44.asServiceRole.entities.MealReservation.update(dupe.id, {
          status: 'CANCELLED',
          notes: (dupe.notes ? dupe.notes + '\n' : '') + 'כפילות מוזגה לפי טופס חיצוני',
        });
      }
    }

    // Rebuild active meal map after cleanup — use the canonical (kept) row per key
    const allActiveMealByKey = {};
    for (const [key, rows] of Object.entries(mealsByKey)) {
      // canonical is always rows[0] after sort (dupes were cancelled above)
      const canonical = rows[0];
      allActiveMealByKey[key] = canonical;
    }

    // groupSync meals keyed by date|meal_type — used to detect existing sync rows
    // NOTE: key only on group_id scope, not profile_id, to catch cross-profile dupes
    const groupSyncMealByKey = {};
    existingGroupSyncMeals.forEach(item => {
      if (item.status !== 'CANCELLED') {
        const key = `${item.date}|${item.meal_type}`;
        groupSyncMealByKey[key] = item;
      }
    });

    let scheduleCreated = 0, scheduleUpdated = 0;
    let mealsCreated = 0, mealsUpdated = 0;
    const warnings = [];

    if (!submission) {
      warnings.push('NO_GUEST_FORM_SUBMISSION');
      console.log('[prefillGroupScheduleAndMeals] no submission — partial sync only');
      return Response.json({
        success: true,
        partial: true,
        warnings,
        message: 'סנכרון חלקי בוצע — שאלון לקוח עדיין חסר',
        schedule: { created: 0, updated: 0 },
        meals: { created: 0, updated: 0 },
      });
    }

    // ── Schedule rows ───────────────────────────────────────────────────────
    step = 'sync_schedule';
    let scheduleRows = [];
    if (submission.schedule_notes) {
      try { scheduleRows = JSON.parse(submission.schedule_notes); } catch {}
    }

    // SAFETY: talk suggestions are intake-only — never create GroupScheduleItem from them
    const normalScheduleRows = scheduleRows.filter(r => !r.is_talk_suggestion);
    for (const row of normalScheduleRows) {
      if (!row.date) continue;
      const dateValidation = await validateDatedOperationalDate(base44, group, row.date);
      if (!dateValidation.valid) {
        return Response.json({ success: false, error: dateValidation.message, error_code: dateValidation.code }, { status: 400 });
      }
    }

    for (const row of normalScheduleRows) {
      if (!row.date || !row.start_time || !row.activity) continue;
      const start_time = row.start_time || '09:00';
      const end_time   = row.end_time   || addMinutes(start_time, 60);
      const key = `${row.date}|${start_time}|${row.activity}`;

      const NEEDS_LABELS = { microphone: 'מיקרופון', projector: 'מקרן', chairs: 'סידור כיסאות', tables: 'שולחנות', whiteboard: 'לוח כתיבה' };
      let needsNote = '';
      if (row.needs && typeof row.needs === 'object') {
        const parts = Object.entries(NEEDS_LABELS)
          .filter(([k]) => row.needs[k])
          .map(([, label]) => label);
        if (row.needs.other) parts.push(row.needs.other_text ? `אחר: ${row.needs.other_text}` : 'אחר');
        if (parts.length) needsNote = `צרכים לפעילות: ${parts.join(', ')}`;
      }
      const combinedNotes = [needsNote, row.notes].filter(Boolean).join('. ') || null;

      const payload = {
        group_id,
        operational_group_profile_id,
        date: row.date,
        start_time,
        end_time,
        activity_name: row.activity,
        requested_location: row.location || 'אחר',
        activity_space_id: null,
        activity_space_code: null,
        pax: row.pax ? Number(row.pax) : null,
        notes: combinedNotes,
        source: 'groupSync',
        status: 'ACTIVE',
      };

      if (scheduleByKey[key]) {
        await base44.asServiceRole.entities.GroupScheduleItem.update(scheduleByKey[key].id, payload);
        scheduleUpdated++;
      } else {
        await base44.asServiceRole.entities.GroupScheduleItem.create(payload);
        scheduleCreated++;
      }
    }

    // ── Meal rows ───────────────────────────────────────────────────────────
    step = 'sync_meals';
    let mealRows = [];
    if (submission.meal_plan) {
      try { mealRows = JSON.parse(submission.meal_plan); } catch {}
    }

    let specialDiets = {};
    if (submission.special_diets) {
      try { specialDiets = JSON.parse(submission.special_diets); } catch {}
    }

    const dietSummaryText = buildDietSummary(specialDiets);
    const dietSummaryJson = JSON.stringify(specialDiets);

    const arrivalLunchNote   = submission.arrival_lunch   ? 'צהריים ביום הגעה'  : null;
    const departureLunchNote = submission.departure_lunch ? 'צהריים ביום עזיבה' : null;
    const extraNotes = [arrivalLunchNote, departureLunchNote, submission.general_notes]
      .filter(Boolean).join(' | ');

    const mealConflicts = [];

    for (const row of mealRows) {
      if (!row.date || !row.meal_type) continue;
      const mealTypeMap = { BREAKFAST: 'BREAKFAST', LUNCH: 'LUNCH', DINNER: 'DINNER' };
      const meal_type = mealTypeMap[row.meal_type] || 'OTHER';

      const defaults = MEAL_DEFAULTS[meal_type] || MEAL_DEFAULTS.OTHER;
      const key = `${row.date}|${meal_type}`;

      const existingGroupSync = groupSyncMealByKey[key];
      const existingAny       = allActiveMealByKey[key];

      // Canonical existing row: prefer the one we know about (any source)
      const existingRow = existingAny || existingGroupSync;

      const newPax = profile.total_pax || submission.total_pax || 0;
      const newSandwich = row.sandwich_instead || false;
      const newNotes = [dietSummaryText, extraNotes].filter(Boolean).join('\n') || null;

      if (existingRow) {
        // ── UPDATE existing row (regardless of source) ──────────────────────
        const oldPax      = existingRow.pax;
        const oldSandwich = existingRow.sandwich_option;
        const wasChanged  = oldPax !== newPax || oldSandwich !== newSandwich;

        // Merge notes: preserve existing manual notes + add GuestForm data
        let mergedNotes = newNotes;
        if (existingRow.notes && existingRow.source === 'manual') {
          mergedNotes = [
            `הערות קודמות:\n${existingRow.notes}`,
            newNotes ? `נתוני לקוח מהטופס:\n${newNotes}` : null,
          ].filter(Boolean).join('\n\n');
        }

        await base44.asServiceRole.entities.MealReservation.update(existingRow.id, {
          pax:                   newPax,
          special_diets_summary: dietSummaryJson,
          sandwich_option:       newSandwich,
          notes:                 mergedNotes,
          // Preserve source + operational_group_profile_id of existing row
          operational_group_profile_id: existingRow.operational_group_profile_id || operational_group_profile_id,
          status: 'ACTIVE',
        });
        mealsUpdated++;

        if (wasChanged) {
          mealConflicts.push({
            date: row.date,
            meal_type,
            existing_source: existingRow.source,
            old_pax: oldPax,
            new_pax: newPax,
            old_sandwich: oldSandwich,
            new_sandwich: newSandwich,
          });
          warnings.push(`MEAL_UPDATED:${key}`);
        }
      } else {
        // ── CREATE new meal ──────────────────────────────────────────────────
        await base44.asServiceRole.entities.MealReservation.create({
          group_id,
          operational_group_profile_id,
          date: row.date,
          meal_type,
          start_time: defaults.start_time,
          end_time:   defaults.end_time,
          pax:                   newPax,
          special_diets_summary: dietSummaryJson,
          sandwich_option:       newSandwich,
          notes:                 newNotes,
          source: 'groupSync',
          status: 'ACTIVE',
        });
        mealsCreated++;
      }
    }

    // Create a single KITCHEN alert if GuestForm changed/updated any existing meals
    if (mealConflicts.length > 0) {
      try {
        const changedList = mealConflicts
          .map(c => `${c.date} — ${c.meal_type} (${c.old_pax}→${c.new_pax} נפשות)`)
          .join(', ');
        await base44.asServiceRole.entities.OperationalReviewAlert.create({
          group_id,
          module:   'KITCHEN',
          severity: 'WARNING',
          source:   'MEAL_CHANGED',
          title:    'ארוחות עודכנו לפי טופס חיצוני',
          message:  `נתוני הארוחות עודכנו לפי הטופס החיצוני של הלקוח. יש לבדוק את השינויים במטבח: ${changedList}`,
          status:   'OPEN',
          new_value_json: JSON.stringify({ conflicts: mealConflicts, submission_id: profile.guest_form_submission_id }),
        });
      } catch (alertErr) {
        console.warn('[prefillGroupScheduleAndMeals] failed to create meal changed alert:', alertErr?.message);
      }
    }

    // ── Cancel out-of-range meals (group dates may have been shortened) ────────
    step = 'cancel_out_of_range';
    let cancelledOutOfRange = 0;
    if (group?.arrival_date || group?.departure_date) {
      const allActiveMeals = await base44.asServiceRole.entities.MealReservation.filter({ group_id });
      const outOfRange = allActiveMeals.filter(m => {
        if (m.status === 'CANCELLED') return false;
        if (group.arrival_date  && m.date < group.arrival_date)  return true;
        if (group.departure_date && m.date > group.departure_date) return true;
        return false;
      });
      for (const m of outOfRange) {
        await base44.asServiceRole.entities.MealReservation.update(m.id, {
          status: 'CANCELLED',
          notes: (m.notes ? m.notes + '\n' : '') + 'בוטל — מחוץ לטווח תאריכי הקבוצה',
        });
        cancelledOutOfRange++;
      }
      if (cancelledOutOfRange > 0) {
        console.log(`[prefillGroupScheduleAndMeals] cancelled ${cancelledOutOfRange} out-of-range meals`);
        warnings.push(`OUT_OF_RANGE_CANCELLED:${cancelledOutOfRange}`);
      }
    }

    console.log(`[prefillGroupScheduleAndMeals] done: schedule +${scheduleCreated} ~${scheduleUpdated}, meals +${mealsCreated} ~${mealsUpdated}, cancelled_out_of_range: ${cancelledOutOfRange}`);

    return Response.json({
      success: true,
      partial: false,
      warnings,
      meal_conflicts: mealConflicts,
      schedule: { created: scheduleCreated, updated: scheduleUpdated },
      meals: { created: mealsCreated, updated: mealsUpdated, cancelled_out_of_range: cancelledOutOfRange },
    });

  } catch (error) {
    console.error(`[prefillGroupScheduleAndMeals] FAILED at step="${step}"`, error?.message);
    return Response.json({
      success: false,
      error: 'סנכרון הנתונים נכשל',
      debug: { step, message: error?.message || String(error) },
    }, { status: 500 });
  }
});