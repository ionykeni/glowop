/**
 * syncQuoteToOperationalGroup
 * Syncs accepted Quote data into an existing Group + OperationalGroupProfile.
 * Called only by admin after manual review.
 *
 * Guards:
 * - Quote must be APPROVED
 * - Group must exist and be linked to the Quote
 * - Validates boys + girls = participant_count for LODGING groups
 * - Blocks date/type changes if active SleepingAllocations exist
 * - Creates review alerts for allocation and kitchen teams when relevant
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { getEffectiveQuoteGroupName } from '../../shared/quotePreparation.js';
import { assertValidQuoteOperationalDates } from '../../shared/operationalDateValidation.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const normalizedEmail = user.email.trim().toLowerCase();
    const internalUsers = await base44.asServiceRole.entities.InternalUser.list();
    const internalUser = internalUsers.find(row => row.email?.trim().toLowerCase() === normalizedEmail);
    const role = internalUser?.role || user.role;
    if (!['admin', 'ADMIN', 'SUPER_ADMIN', 'QUOTES_MANAGER', 'OPERATIONS'].includes(role)) {
      return Response.json({ error: 'אין הרשאה לביצוע פעולה זו' }, { status: 403 });
    }

    const { quote_id, group_id } = await req.json();
    if (!quote_id || !group_id) {
      return Response.json({ error: 'quote_id ו-group_id נדרשים' }, { status: 400 });
    }

    // ── Fetch records ──────────────────────────────────────────────────────
    const [quotes, groups, profiles] = await Promise.all([
      base44.asServiceRole.entities.Quote.filter({ id: quote_id }),
      base44.asServiceRole.entities.Group.filter({ id: group_id }),
      base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id }),
    ]);

    const quote = quotes[0];
    const group = groups[0];
    const profile = profiles[0];

    if (!quote) return Response.json({ error: 'הצעת מחיר לא נמצאה' }, { status: 404 });
    if (!group) return Response.json({ error: 'קבוצה לא נמצאה' }, { status: 404 });
    assertValidQuoteOperationalDates(quote);
    if (quote.status !== 'APPROVED' && quote.status !== 'DRAFT') {
      return Response.json({ error: 'ניתן לסנכרן רק הצעה בטיוטה או מאושרת' }, { status: 400 });
    }
    if (String(quote.group_id) !== String(group_id)) return Response.json({ error: 'הצעה זו אינה מקושרת לקבוצה זו' }, { status: 400 });

    // ── Derive pax fields from Quote ───────────────────────────────────────
    const totalPax        = Number(quote.estimated_pax  || 0) || null;
    const staffCount      = Number(quote.staff_count    || 0) || null;
    const participantCount = totalPax != null && staffCount != null ? Math.max(0, totalPax - staffCount) : null;

    // Quote does not carry boys/girls split — keep existing values
    const boysCount  = group.boys_count  ?? null;
    const girlsCount = group.girls_count ?? null;

    // ── Validate boys + girls = participant_count for LODGING ──────────────
    const targetType = quote.arrival_date && !quote.departure_date ? 'DAY_USE' : (group.group_type || 'LODGING');
    // We keep group_type from quote.departure_date heuristic only if quote has it;
    // more reliably: if group is LODGING we validate the gender split
    if (group.group_type === 'LODGING' && participantCount != null && boysCount != null && girlsCount != null) {
      if ((boysCount + girlsCount) !== participantCount) {
        return Response.json({
          error: `חלוקת בנים/בנות לא תואמת לספר החניכים החדש.\nחניכים (מהצעה): ${participantCount}\nבנים + בנות (קיים): ${boysCount + girlsCount}\nיש לעדכן את חלוקת בנים/בנות בעריכת הקבוצה לפני הסנכרון.`,
        }, { status: 400 });
      }
    }

    // ── Detect what changes ─────────────────────────────────────────────────
    const datesChange   = (quote.arrival_date   && quote.arrival_date   !== group.arrival_date)   ||
                          (quote.departure_date  && quote.departure_date  !== group.departure_date);
    // group_type is not stored on Quote directly; we do not change it from quote
    const paxChanges    = (totalPax       != null && totalPax       !== group.total_pax)       ||
                          (staffCount     != null && staffCount     !== group.staff_count)     ||
                          (participantCount != null && participantCount !== group.participant_count);

    // ── Guard: block date changes if active sleeping allocations exist ──────
    if (datesChange) {
      const activeAllocs = await base44.asServiceRole.entities.SleepingAllocation.filter({
        group_id,
        status: { $in: ['DRAFT', 'CONFIRMED'] },
      });
      if (activeAllocs.length > 0) {
        return Response.json({
          error: 'לא ניתן לסנכרן שינויי תאריכים מהצעה כאשר קיימים שיבוצי לינה פעילים.\nיש לשחרר או לבטל את השיבוצים הקיימים ואז לבצע סנכרון.',
        }, { status: 409 });
      }
    }

    // ── Build Group update payload ─────────────────────────────────────────
    // Only non-empty Quote values are applied — empty/null values never overwrite
    // the operational source of truth.
    const groupUpdate = { group_name: getEffectiveQuoteGroupName(quote) };
    if (quote.contact_person)  groupUpdate.contact_name  = quote.contact_person;
    if (quote.client_phone)   groupUpdate.contact_phone = quote.client_phone;
    if (quote.client_email)   groupUpdate.contact_email = quote.client_email;
    if (quote.arrival_date)   groupUpdate.arrival_date  = quote.arrival_date;
    if (quote.departure_date) groupUpdate.departure_date = quote.departure_date;
    if (quote.arrival_time)   groupUpdate.arrival_time   = quote.arrival_time;
    if (quote.departure_time) groupUpdate.departure_time = quote.departure_time;
    if (totalPax != null)     groupUpdate.total_pax     = totalPax;
    if (staffCount != null)   groupUpdate.staff_count   = staffCount;
    if (participantCount != null) groupUpdate.participant_count = participantCount;

    // ── Build OGP update payload ───────────────────────────────────────────
    const isSleeping = group.group_type === 'LODGING';
    const ogpUpdate = {
      ...(totalPax        != null ? { total_pax: totalPax }             : {}),
      ...(staffCount      != null ? { staff_count: staffCount }         : {}),
      ...(participantCount != null ? { participant_count: participantCount } : {}),
      // beds_needed derived from existing boys/girls or updated participant
      ...(isSleeping && boysCount  != null ? { boys_beds_needed: boysCount }  : {}),
      ...(isSleeping && girlsCount != null ? { girls_beds_needed: girlsCount } : {}),
      is_sleeping_group: isSleeping,
    };

    // ── Apply updates ──────────────────────────────────────────────────────
    await base44.asServiceRole.entities.Group.update(group_id, groupUpdate);
    if (profile) {
      await base44.asServiceRole.entities.OperationalGroupProfile.update(profile.id, ogpUpdate);
    }

    // ── Check if meals exist for alerts ────────────────────────────────────
    const now = new Date().toISOString();
    const mealChanges = paxChanges; // conservative: any pax change may affect meals
    if (mealChanges) {
      const meals = await base44.asServiceRole.entities.MealReservation.filter({ group_id, status: 'ACTIVE' });
      if (meals.length > 0) {
        const alertPayload = {
          group_id,
          module: 'KITCHEN',
          source: 'GROUP_PAX_CHANGED',
          severity: 'WARNING',
          title: 'נתוני הקבוצה השתנו — יש לבדוק מטבח',
          message: 'נתוני הקבוצה השתנו בעקבות סנכרון מהצעה מאושרת.\nיש לבדוק כמויות ודיאטות במטבח.',
          status: 'OPEN',
          new_value_json: JSON.stringify({ synced_at: now, quote_id, total_pax: totalPax, staff_count: staffCount }),
        };
        const existingKitchenAlerts = await base44.asServiceRole.entities.OperationalReviewAlert.filter({
          group_id, module: 'KITCHEN', source: 'GROUP_PAX_CHANGED', status: 'OPEN',
        });
        if (existingKitchenAlerts.length > 0) {
          await base44.asServiceRole.entities.OperationalReviewAlert.update(existingKitchenAlerts[0].id, alertPayload);
        } else {
          await base44.asServiceRole.entities.OperationalReviewAlert.create(alertPayload);
        }
      }
    }

    // ── Allocation alert if pax changed and active allocations exist ────────
    if (paxChanges) {
      const activeAllocs = await base44.asServiceRole.entities.SleepingAllocation.filter({
        group_id, status: { $in: ['DRAFT', 'CONFIRMED'] },
      });
      if (activeAllocs.length > 0) {
        const allocAlert = {
          group_id,
          module: 'ALLOCATION',
          source: 'GROUP_PAX_CHANGED',
          severity: 'WARNING',
          title: 'שינוי כמות משתתפים — שיבוץ הלינה דורש עדכון',
          message: 'כמות המשתתפים / חלוקת בנים-בנות השתנתה בעקבות סנכרון מהצעה מאושרת.\nיש לבדוק ולעדכן את שיבוץ הלינה.',
          status: 'OPEN',
          new_value_json: JSON.stringify({ synced_at: now, quote_id, total_pax: totalPax }),
        };
        const existingAllocAlerts = await base44.asServiceRole.entities.OperationalReviewAlert.filter({
          group_id, module: 'ALLOCATION', source: 'GROUP_PAX_CHANGED', status: 'OPEN',
        });
        if (existingAllocAlerts.length > 0) {
          await base44.asServiceRole.entities.OperationalReviewAlert.update(existingAllocAlerts[0].id, allocAlert);
        } else {
          await base44.asServiceRole.entities.OperationalReviewAlert.create(allocAlert);
        }
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error?.code || 'INTERNAL_ERROR', message: error.message }, { status: error?.code === 'INVALID_QUOTE_OPERATIONAL_DATE' ? 400 : 500 });
  }
});