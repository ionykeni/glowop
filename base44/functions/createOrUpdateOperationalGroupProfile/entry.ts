import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { assertOperationalGroup } from '../../shared/quotePreparationConfig.js';

Deno.serve(async (req) => {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));

    // ── Auth — non-fatal (same pattern as confirmSleepingAllocations) ─────
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (authErr) {
      console.warn('[createOrUpdateOperationalGroupProfile] auth.me() threw (non-fatal):', authErr?.message);
    }
    if (!user) {
      console.warn('[createOrUpdateOperationalGroupProfile] no authenticated user — proceeding with service role only');
    } else {
      console.log(`[createOrUpdateOperationalGroupProfile] user: ${user.email} role: ${user.role}`);
    }

    const body = await req.json();
    const { group_id, quote_id } = body;

    if (!group_id) {
      return Response.json({ success: false, error: 'חסר מזהה קבוצה (group_id)' }, { status: 400 });
    }

    // ── Fetch Quote ────────────────────────────────────────────────────────
    let quote = null;
    if (quote_id) {
      try {
        const quotes = await base44.asServiceRole.entities.Quote.filter({ id: quote_id });
        quote = quotes[0] || null;
      } catch (e) {
        console.warn('[createOrUpdateOperationalGroupProfile] could not fetch quote:', e?.message);
      }
    }

    // ── Fetch Group ────────────────────────────────────────────────────────
    let group = null;
    const resolvedGroupId = group_id || quote?.group_id;
    if (!resolvedGroupId) {
      return Response.json({ success: false, error: 'לא ניתן לזהות קבוצה — חסר group_id' }, { status: 400 });
    }
    try {
      const groups = await base44.asServiceRole.entities.Group.filter({ id: resolvedGroupId });
      group = groups[0] || null;
    } catch (e) {
      console.warn('[createOrUpdateOperationalGroupProfile] could not fetch group:', e?.message);
    }
    if (!group) {
      return Response.json({ success: false, error: 'הקבוצה לא נמצאה במערכת' }, { status: 404 });
    }
    try { assertOperationalGroup(group); } catch (error) { return Response.json({ success: false, error: error.code }, { status: 409 }); }

    // ── Update Group status → CONFIRMED ───────────────────────────────────
    await base44.asServiceRole.entities.Group.update(resolvedGroupId, { status: 'CONFIRMED' });
    console.log(`[createOrUpdateOperationalGroupProfile] Group ${resolvedGroupId} → CONFIRMED`);

    // ── Build profile payload from Group + Quote (never overwrite with null) ─
    const now = new Date().toISOString();

    // Helper: pick first non-null/non-undefined value
    const pick = (...vals) => vals.find(v => v !== null && v !== undefined && v !== '');

    const profileData = {
      group_id: resolvedGroupId,
      status: 'ACCEPTED',
      accepted_at: now,
      is_sleeping_group: group.group_type === 'LODGING',
    };

    // Sync dates from group (authoritative source)
    if (group.arrival_date)   profileData.arrival_date   = group.arrival_date;
    if (group.departure_date) profileData.departure_date = group.departure_date;

    // Sync pax — group first, then quote fallback
    const totalPax = pick(group.total_pax, quote?.estimated_pax);
    const staffCount = pick(group.staff_count, quote?.staff_count);
    const participantCount = pick(group.participant_count, quote?.participant_count);

    if (totalPax       != null) profileData.total_pax        = totalPax;
    if (staffCount     != null) profileData.staff_count      = staffCount;
    if (participantCount != null) profileData.participant_count = participantCount;
    if (group.boys_count  != null) profileData.boys_count  = group.boys_count;
    if (group.girls_count != null) profileData.girls_count = group.girls_count;

    // Quote link
    if (quote_id) profileData.quote_id = quote_id;

    // Notes
    const notes = pick(group.internal_notes, quote?.internal_notes);
    if (notes) profileData.general_notes = notes;

    // ── Create or update OperationalGroupProfile ───────────────────────────
    const existingProfiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({
      group_id: resolvedGroupId,
    });
    const existing = existingProfiles[0] || null;

    let profileId;
    if (existing) {
      // Only sync fields that have a new value — do not overwrite useful existing data with empty
      const safeUpdate = {};
      for (const [k, v] of Object.entries(profileData)) {
        if (v !== null && v !== undefined && v !== '') {
          // For pax fields on an existing profile, only overwrite if the profile has none set
          const paxFields = ['total_pax', 'staff_count', 'participant_count', 'boys_count', 'girls_count'];
          if (paxFields.includes(k) && existing[k] != null && existing[k] !== 0) continue;
          safeUpdate[k] = v;
        }
      }
      // Always force status + accepted_at
      safeUpdate.status = 'ACCEPTED';
      safeUpdate.accepted_at = now;
      if (quote_id && !existing.quote_id) safeUpdate.quote_id = quote_id;

      await base44.asServiceRole.entities.OperationalGroupProfile.update(existing.id, safeUpdate);
      profileId = existing.id;
      console.log(`[createOrUpdateOperationalGroupProfile] Updated existing profile ${profileId}`);
    } else {
      const created = await base44.asServiceRole.entities.OperationalGroupProfile.create(profileData);
      profileId = created.id;
      console.log(`[createOrUpdateOperationalGroupProfile] Created new profile ${profileId}`);
    }

    return Response.json({
      success: true,
      group_id: resolvedGroupId,
      profile_id: profileId,
      action: existing ? 'updated' : 'created',
    });

  } catch (error) {
    console.error('[createOrUpdateOperationalGroupProfile] unexpected error:', error?.message);
    return Response.json({
      success: false,
      error: 'שגיאה פנימית בשרת — אנא נסה שוב',
    }, { status: 500 });
  }
});