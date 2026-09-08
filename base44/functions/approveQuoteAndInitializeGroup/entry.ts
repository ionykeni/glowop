import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getEffectiveQuoteGroupName } from '../../shared/quotePreparation.js';
import { ensureExactlyOneOperationalProfile } from '../../shared/operationalProfile.js';
import { assertQuoteMultiOptionEnabled, resolveSelectedQuoteOption, buildApprovedOptionSnapshot, markSelectedQuoteOption } from '../../shared/quoteOptions.js';
import { assertValidQuoteOperationalDates } from '../../shared/operationalDateValidation.js';

/**
 * approveQuoteAndInitializeGroup
 * ------------------------------------------------------------------
 * Approving a Quote must FIRST initialize the operational source of truth
 * (Group + exactly one OperationalGroupProfile), and ONLY THEN mark the
 * Quote APPROVED. If any operational step fails, the Quote is NOT approved.
 *
 * Hard rules:
 *   - Never silently overwrite existing operational Group/OGP data from Quote.
 *   - Group is the source of truth for identity/core fields → mapped from Quote
 *     ONLY when a NEW Group is created.
 *   - OGP is the source of truth for operational details → mapped from Quote
 *     ONLY when the OGP was just created OR the specific field is empty/null.
 *   - Divergences between Quote and existing Group/OGP produce warnings, never
 *     overwrites.
 *   - Idempotent + duplicate-safe (no DB transactions → careful ordering).
 *
 * Links in this schema:
 *   - quote.group_id                     → Quote → Group   (primary link)
 *   - Group has NO quote_id field        → no reverse link written on Group
 *   - operational_group_profile.quote_id → OGP → Quote     (set when empty)
 * ------------------------------------------------------------------
 */

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'QUOTES_MANAGER', 'OPERATIONS']);

// Fields mapped Quote → Group, ONLY when creating a NEW Group.
// Quote carries client_* / estimated_pax; Group uses contact_* — mapped below.
function buildGroupFromQuote(quote) {
  const g = { status: 'DRAFT' };
  g.group_name     = getEffectiveQuoteGroupName(quote);
  // group_type: DAY_USE when quote is day_use OR single-day; else LODGING
  const isSingleDay = quote.arrival_date && (!quote.departure_date || quote.departure_date === quote.arrival_date);
  g.group_type     = quote.quote_type === 'day_use' || isSingleDay ? 'DAY_USE' : 'LODGING';
  if (quote.arrival_date)   g.arrival_date   = quote.arrival_date;
  g.departure_date = quote.departure_date || quote.arrival_date || undefined;
  if (quote.arrival_time)   g.arrival_time   = quote.arrival_time;
  if (quote.departure_time) g.departure_time = quote.departure_time;
  if (quote.contact_person) g.contact_name = quote.contact_person;
  if (quote.client_phone)   g.contact_phone  = quote.client_phone;
  if (quote.client_email)   g.contact_email  = quote.client_email;
  if (quote.internal_notes) g.internal_notes = quote.internal_notes;
  // strip undefined
  Object.keys(g).forEach(k => g[k] === undefined && delete g[k]);
  return g;
}

async function ensureOgp(base44, group_id, group) {
  const ensured = await ensureExactlyOneOperationalProfile(base44, { ...group, id: group_id }, 'MULTIPLE_OPERATIONAL_PROFILES');
  return { ogp: ensured.profile, created: ensured.created };
}

// Derive OGP operational values from Quote (Quote has no boys/girls split).
function ogpValuesFromQuote(quote) {
  const totalPax   = quote.estimated_pax   != null ? Number(quote.estimated_pax)   : null;
  const staffCount = quote.staff_count     != null ? Number(quote.staff_count)     : null;
  let participant  = quote.participant_count != null ? Number(quote.participant_count) : null;
  if (participant == null && totalPax != null && staffCount != null) {
    participant = Math.max(0, totalPax - staffCount);
  }
  const out = {};
  if (totalPax   != null) out.total_pax         = totalPax;
  if (staffCount != null) out.staff_count       = staffCount;
  if (participant != null) out.participant_count = participant;
  return out;
}

const isEmpty = (v) => v === null || v === undefined || v === '';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ─────────────────────────────────────────────────────────────────
    let user = null;
    try { user = await base44.auth.me(); } catch { /* handled below */ }
    if (!user) {
      return Response.json({ success: false, error: 'UNAUTHORIZED', message: 'נדרשת התחברות' }, { status: 401 });
    }
    let effectiveRole = user.role;
    try {
      const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
      if (internalUsers[0]?.role) effectiveRole = internalUsers[0].role;
    } catch { /* fall back to platform role */ }
    if (!ALLOWED_ROLES.has(effectiveRole)) {
      return Response.json({ success: false, error: 'FORBIDDEN', message: 'אין הרשאה לאשר הצעת מחיר' }, { status: 403 });
    }

    // ── Input ──────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { quote_id, selected_option_key } = body;
    if (!quote_id || typeof quote_id !== 'string') {
      return Response.json({
        success: false, error: 'MISSING_QUOTE_ID', message: 'חסר מזהה הצעת מחיר (quote_id)',
      }, { status: 400 });
    }

    // ── Load Quote ───────────────────────────────────────────────────────────
    let quote = null;
    try { quote = await base44.asServiceRole.entities.Quote.get(quote_id); } catch { /* handled */ }
    if (!quote) {
      return Response.json({
        success: false, error: 'QUOTE_NOT_FOUND', message: 'הצעת המחיר לא נמצאה', quote_id,
      }, { status: 404 });
    }
    assertValidQuoteOperationalDates(quote);

    if (quote.multi_option_enabled) assertQuoteMultiOptionEnabled(effectiveRole);
    const selection = await resolveSelectedQuoteOption(base44, quote, selected_option_key);
    const warnings = [];
    const alreadyApproved = String(quote.status || '').toUpperCase() === 'APPROVED';

    // ── Resolve or create Group ─────────────────────────────────────────────
    let group = null;
    let groupJustCreated = false;

    if (quote.group_id) {
      try { group = await base44.asServiceRole.entities.Group.get(quote.group_id); } catch { /* handled */ }
      if (!group) {
        return Response.json({
          success: false, error: 'QUOTE_GROUP_LINK_BROKEN',
          message: 'ההצעה מקושרת לקבוצה שאינה קיימת עוד — נדרשת בדיקת מנהל',
          quote_id, group_id: quote.group_id,
        }, { status: 409 });
      }
    } else {
      // No link → create a new Group (never dedupe by name alone)
      try {
        group = await base44.asServiceRole.entities.Group.create(buildGroupFromQuote(quote));
        groupJustCreated = true;
      } catch (err) {
        console.error('[approveQuoteAndInitializeGroup] group create failed:', err?.message);
        return Response.json({
          success: false, error: 'GROUP_CREATE_FAILED', message: 'יצירת הקבוצה נכשלה', quote_id,
        }, { status: 500 });
      }
    }
    const group_id = group.id;
    const groupAlreadyOperational = group.status === 'CONFIRMED';

    // ── Ensure exactly one OGP ──────────────────────────────────────────────
    let ogp = null;
    let ogpJustCreated = false;
    try {
      const res = await ensureOgp(base44, group_id, group);
      ogp = res.ogp;
      ogpJustCreated = res.created;
    } catch (err) {
      if (err?.code === 'MULTIPLE_OPERATIONAL_PROFILES' || err?.code === 'MULTIPLE_OPERATIONAL_PROFILES_AFTER_CREATE') {
        return Response.json({
          success: false, error: err.code,
          message: 'נמצאו מספר פרופילים תפעוליים לקבוצה — נדרשת בדיקת מנהל (לא נמחק דבר)',
          quote_id, group_id, profile_ids: err.profile_ids,
        }, { status: 409 });
      }
      // Group may have just been created → do NOT hide partial state, do NOT approve.
      console.error('[approveQuoteAndInitializeGroup] OGP ensure failed:', err?.message);
      return Response.json({
        success: false, error: 'OGP_CREATE_FAILED_AFTER_GROUP',
        message: 'הקבוצה קיימת אך יצירת הפרופיל התפעולי נכשלה — יש להריץ שוב או לתקן ידנית',
        quote_id, group_id,
      }, { status: 500 });
    }

    // ── Link Quote → OGP (OGP.quote_id) when empty ──────────────────────────
    if (!groupAlreadyOperational && isEmpty(ogp.quote_id)) {
      try {
        await base44.asServiceRole.entities.OperationalGroupProfile.update(ogp.id, { quote_id });
        ogp.quote_id = quote_id;
      } catch (err) {
        console.error('[approveQuoteAndInitializeGroup] OGP link update failed:', err?.message);
        return Response.json({
          success: false, error: 'QUOTE_LINK_UPDATE_FAILED',
          message: 'קישור ההצעה לפרופיל התפעולי נכשל — ההצעה לא אושרה',
          quote_id, group_id, operational_group_profile_id: ogp.id,
        }, { status: 500 });
      }
    } else if (!groupAlreadyOperational && String(ogp.quote_id) !== String(quote_id)) {
      warnings.push('QUOTE_OGP_LINK_DIFFERS');
    }

    // ── Field mapping into OGP — only newly created OR empty fields ──────────
    const quoteOgpVals = groupAlreadyOperational ? {} : ogpValuesFromQuote(quote);
    const ogpUpdate = {};
    for (const [key, val] of Object.entries(quoteOgpVals)) {
      if (ogpJustCreated || isEmpty(ogp[key])) {
        ogpUpdate[key] = val;
      } else if (Number(ogp[key]) !== Number(val)) {
        // existing non-empty value differs → warn, do NOT overwrite
        if (key === 'total_pax' || key === 'participant_count' || key === 'staff_count') {
          if (!warnings.includes('QUOTE_OGP_PAX_DIFFER')) warnings.push('QUOTE_OGP_PAX_DIFFER');
        }
      }
    }
    if (Object.keys(ogpUpdate).length > 0) {
      try {
        await base44.asServiceRole.entities.OperationalGroupProfile.update(ogp.id, ogpUpdate);
      } catch (err) {
        console.warn('[approveQuoteAndInitializeGroup] OGP field map update failed (non-fatal):', err?.message);
        warnings.push('OGP_FIELD_MAP_UPDATE_FAILED');
      }
    }

    // ── Divergence warnings against existing Group (never overwrite) ─────────
    if (!groupJustCreated) {
      const contactDiffers =
        (!isEmpty(quote.client_name)  && !isEmpty(group.contact_name)  && quote.client_name  !== group.contact_name) ||
        (!isEmpty(quote.client_phone) && !isEmpty(group.contact_phone) && quote.client_phone !== group.contact_phone) ||
        (!isEmpty(quote.client_email) && !isEmpty(group.contact_email) && quote.client_email !== group.contact_email);
      if (contactDiffers) warnings.push('QUOTE_GROUP_CONTACT_DIFFER');

      const datesDiffer =
        (!isEmpty(quote.arrival_date)   && !isEmpty(group.arrival_date)   && quote.arrival_date   !== group.arrival_date) ||
        (!isEmpty(quote.departure_date) && !isEmpty(group.departure_date) && quote.departure_date !== group.departure_date);
      if (datesDiffer) warnings.push('QUOTE_GROUP_DATES_DIFFER');
    }

    // ── Determine outcome status ────────────────────────────────────────────
    let outcomeStatus;
    if (alreadyApproved) {
      // Quote was already APPROVED. If Group/OGP were missing and we repaired
      // them just now, flag it. Otherwise it's a clean idempotent no-op.
      if (groupJustCreated || ogpJustCreated) {
        warnings.push('APPROVED_QUOTE_REPAIRED_OPERATIONAL_INIT');
      }
      outcomeStatus = 'already_approved';
    } else {
      outcomeStatus = groupJustCreated ? 'created' : 'linked';
    }

    // ── Ensure Quote → Group link exists (set group_id if missing) ──────────
    if (isEmpty(quote.group_id)) {
      try {
        await base44.asServiceRole.entities.Quote.update(quote_id, { group_id });
      } catch (err) {
        console.error('[approveQuoteAndInitializeGroup] quote.group_id link failed:', err?.message);
        return Response.json({
          success: false, error: 'QUOTE_LINK_UPDATE_FAILED',
          message: 'קישור ההצעה לקבוצה נכשל — ההצעה לא אושרה',
          quote_id, group_id, operational_group_profile_id: ogp.id, warnings,
        }, { status: 500 });
      }
    }

    // ── Repair option state first, then approve Quote, then confirm Group ────
    try {
      if (quote.multi_option_enabled) await markSelectedQuoteOption(base44, quote_id, selection.key);
      if (!alreadyApproved) {
        const approvedSnapshot = buildApprovedOptionSnapshot(quote, selection, user, { groupId: group_id, profileId: ogp.id });
        await base44.asServiceRole.entities.Quote.update(quote_id, { status: 'APPROVED', approved_at: new Date().toISOString(), approved_by: user.email, approved_option_key: selection.key, approved_option_total_price: Number(selection.effectiveQuote.total_price || 0), approved_option_snapshot: approvedSnapshot, snapshot: approvedSnapshot });
      }
      if (group.status !== 'CONFIRMED') await base44.asServiceRole.entities.Group.update(group_id, { status: 'CONFIRMED' });
    } catch (err) {
      console.error('[approveQuoteAndInitializeGroup] approval repair failed:', err?.message);
      return Response.json({ success: false, error: err?.code || 'QUOTE_APPROVAL_UPDATE_FAILED', message: 'האישור לא הושלם — ניתן לנסות שוב בבטחה', quote_id, group_id, operational_group_profile_id: ogp.id, warnings }, { status: err?.code ? 409 : 500 });
    }

    const finalQuote = await base44.asServiceRole.entities.Quote.get(quote_id);
    const finalGroup = await base44.asServiceRole.entities.Group.get(group_id);
    const finalProfiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id });
    if (finalProfiles.length !== 1) throw Object.assign(new Error('DUPLICATE_OPERATIONAL_PROFILE'), { code: 'DUPLICATE_OPERATIONAL_PROFILE', profile_ids: finalProfiles.map(p => p.id) });
    return Response.json({ success: true, quote: finalQuote, group: finalGroup, profile: finalProfiles[0], quote_id, group_id, operational_group_profile_id: finalProfiles[0].id, quote_status: finalQuote.status, status: outcomeStatus, ...(warnings.length > 0 ? { warnings } : {}) });

  } catch (error) {
    console.error('[approveQuoteAndInitializeGroup] unexpected error:', error?.message, error?.stack);
    const code = error?.code || 'INTERNAL_ERROR';
    return Response.json({
      success: false, error: code, message: code === 'INVALID_QUOTE_OPERATIONAL_DATE' ? error.message : code === 'QUOTE_ALREADY_APPROVED_WITH_DIFFERENT_OPTION' ? 'QUOTE_ALREADY_APPROVED_WITH_DIFFERENT_OPTION' : 'שגיאה פנימית בשרת — אנא נסה שוב',
    }, { status: code === 'INVALID_QUOTE_OPERATIONAL_DATE' ? 400 : error?.code ? 409 : 500 });
  }
});