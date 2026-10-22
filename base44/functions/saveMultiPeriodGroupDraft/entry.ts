import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { deriveStayEnvelope, normalizeStayPeriods, validateStayPeriods } from '../../shared/groupStayPeriods.js';

const ALLOWED_ROLES = new Set(['admin', 'SUPER_ADMIN', 'ADMIN', 'OPERATIONS']);
const GROUP_FIELDS = ['group_name', 'group_type', 'arrival_date', 'departure_date', 'arrival_time', 'departure_time', 'total_pax', 'staff_count', 'participant_count', 'boys_count', 'girls_count', 'contact_name', 'contact_phone', 'contact_email', 'internal_notes', 'stay_mode', 'operationally_active', 'quote_preparation_flow', 'status'];
const OGP_FIELDS = ['total_pax', 'participant_count', 'staff_count', 'boys_count', 'girls_count', 'is_sleeping_group', 'special_diets', 'general_notes', 'boys_beds_needed', 'girls_beds_needed', 'status'];
const PERIOD_FIELDS = ['group_id', 'start_date', 'end_date', 'arrival_time', 'departure_time', 'status', 'notes'];

function pick(source, keys) {
  return Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));
}

function cleanPeriods(periods) {
  return normalizeStayPeriods(periods).filter(period => period.status !== 'CANCELLED').map(period => ({
    ...(period.id ? { id: period.id } : {}),
    start_date: period.start_date,
    end_date: period.end_date,
    arrival_time: period.arrival_time || null,
    departure_time: period.departure_time || null,
    status: 'ACTIVE',
    notes: period.notes || null,
  }));
}

async function rollbackCreate(base44, groupId, profileId) {
  const errors = [];
  try {
    const periods = await base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id: groupId });
    for (const period of periods) await base44.asServiceRole.entities.GroupStayPeriod.delete(period.id);
  } catch (error) { errors.push(`periods:${error.message}`); }
  if (profileId) {
    try { await base44.asServiceRole.entities.OperationalGroupProfile.delete(profileId); }
    catch (error) { errors.push(`profile:${error.message}`); }
  }
  try { await base44.asServiceRole.entities.Group.delete(groupId); }
  catch (error) { errors.push(`group:${error.message}`); }
  return errors;
}

async function rollbackEdit(base44, originals, createdPeriodIds) {
  const errors = [];
  for (const id of createdPeriodIds) {
    try { await base44.asServiceRole.entities.GroupStayPeriod.delete(id); }
    catch (error) { errors.push(`new_period:${id}:${error.message}`); }
  }
  for (const period of originals.periods) {
    try { await base44.asServiceRole.entities.GroupStayPeriod.update(period.id, pick(period, PERIOD_FIELDS)); }
    catch (error) { errors.push(`period:${period.id}:${error.message}`); }
  }
  try { await base44.asServiceRole.entities.OperationalGroupProfile.update(originals.profile.id, pick(originals.profile, OGP_FIELDS)); }
  catch (error) { errors.push(`profile:${error.message}`); }
  try { await base44.asServiceRole.entities.Group.update(originals.group.id, pick(originals.group, GROUP_FIELDS)); }
  catch (error) { errors.push(`group:${error.message}`); }
  return errors;
}

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });

    let role = user.role;
    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email }, '-created_date', 1);
    if (internalUsers[0]?.role) role = internalUsers[0].role;
    if (!ALLOWED_ROLES.has(role)) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const groupId = body?.group_id || null;
    const groupData = body?.group_data;
    const ogpData = body?.ogp_data || {};
    const periods = cleanPeriods(body?.periods);

    if (!groupData || typeof groupData !== 'object') return Response.json({ success: false, error: 'MISSING_GROUP_DATA' }, { status: 400 });
    if (!groupData.group_name || !String(groupData.group_name).trim()) return Response.json({ success: false, error: 'MISSING_GROUP_NAME' }, { status: 400 });
    if (!['LODGING', 'DAY_USE'].includes(groupData.group_type || 'LODGING')) return Response.json({ success: false, error: 'INVALID_GROUP_TYPE' }, { status: 400 });
    if (periods.length < 2) return Response.json({ success: false, error: 'MIN_TWO_ACTIVE_PERIODS' }, { status: 400 });

    const validation = validateStayPeriods(periods);
    if (!validation.valid) return Response.json({ success: false, error: 'INVALID_PERIODS', validation }, { status: 400 });
    const suppliedIds = periods.map(period => period.id).filter(Boolean);
    if (new Set(suppliedIds).size !== suppliedIds.length) return Response.json({ success: false, error: 'DUPLICATE_PERIOD_IDS' }, { status: 400 });

    const envelope = deriveStayEnvelope(periods);
    const first = periods[0];
    const last = periods[periods.length - 1];
    const forcedGroupData = {
      ...pick(groupData, GROUP_FIELDS),
      group_name: String(groupData.group_name).trim(),
      group_type: groupData.group_type || 'LODGING',
      arrival_date: envelope.start_date,
      departure_date: envelope.end_date,
      arrival_time: first.arrival_time || null,
      departure_time: last.departure_time || null,
      stay_mode: 'MULTI_PERIOD',
      status: 'DRAFT',
      operationally_active: false,
      quote_preparation_flow: false,
    };
    const profileData = {
      ...pick(ogpData, OGP_FIELDS),
      status: 'ACCEPTED',
      is_sleeping_group: forcedGroupData.group_type === 'LODGING',
    };

    if (!groupId) {
      let group = null;
      let profile = null;
      try {
        group = await base44.asServiceRole.entities.Group.create(forcedGroupData);
        profile = await base44.asServiceRole.entities.OperationalGroupProfile.create({ ...profileData, group_id: group.id });
        const createdPeriods = [];
        for (const period of periods) {
          createdPeriods.push(await base44.asServiceRole.entities.GroupStayPeriod.create({ ...pick(period, PERIOD_FIELDS), group_id: group.id, status: 'ACTIVE' }));
        }
        const [profilesAfter, periodsAfter] = await Promise.all([
          base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: group.id }),
          base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id: group.id, status: 'ACTIVE' }),
        ]);
        if (profilesAfter.length !== 1 || periodsAfter.length !== periods.length) throw new Error('POST_CREATE_INTEGRITY_CHECK_FAILED');
        return Response.json({ success: true, action: 'created', group, operational_group_profile: profile, periods: periodsAfter });
      } catch (error) {
        const cleanupErrors = group ? await rollbackCreate(base44, group.id, profile?.id) : [];
        return Response.json({ success: false, error: 'CREATE_FAILED', message: error.message, cleanup_complete: cleanupErrors.length === 0, cleanup_errors: cleanupErrors }, { status: 500 });
      }
    }

    const [groups, profiles, existingPeriods] = await Promise.all([
      base44.asServiceRole.entities.Group.filter({ id: groupId }),
      base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: groupId }),
      base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id: groupId }),
    ]);
    const group = groups[0];
    if (!group) return Response.json({ success: false, error: 'GROUP_NOT_FOUND' }, { status: 404 });
    if (group.stay_mode !== 'MULTI_PERIOD' || group.status !== 'DRAFT' || group.operationally_active !== false || group.quote_preparation_flow === true) {
      return Response.json({ success: false, error: 'NOT_EDITABLE_MULTI_PERIOD_DRAFT' }, { status: 409 });
    }
    if (profiles.length !== 1) return Response.json({ success: false, error: 'EXPECTED_EXACTLY_ONE_OGP', profile_count: profiles.length }, { status: 409 });

    const existingById = new Map(existingPeriods.map(period => [period.id, period]));
    for (const id of suppliedIds) {
      const existing = existingById.get(id);
      if (!existing || existing.status === 'CANCELLED') return Response.json({ success: false, error: 'INVALID_PERIOD_ID', period_id: id }, { status: 409 });
    }

    const originals = { group, profile: profiles[0], periods: existingPeriods };
    const createdPeriodIds = [];
    try {
      await base44.asServiceRole.entities.Group.update(groupId, forcedGroupData);
      await base44.asServiceRole.entities.OperationalGroupProfile.update(profiles[0].id, profileData);

      const incomingIds = new Set(suppliedIds);
      for (const period of periods) {
        const periodPayload = { ...pick(period, PERIOD_FIELDS), group_id: groupId, status: 'ACTIVE' };
        if (period.id) await base44.asServiceRole.entities.GroupStayPeriod.update(period.id, periodPayload);
        else {
          const created = await base44.asServiceRole.entities.GroupStayPeriod.create(periodPayload);
          createdPeriodIds.push(created.id);
        }
      }
      for (const existing of existingPeriods) {
        if (existing.status === 'ACTIVE' && !incomingIds.has(existing.id)) {
          await base44.asServiceRole.entities.GroupStayPeriod.update(existing.id, { status: 'CANCELLED' });
        }
      }

      const activeAfter = await base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id: groupId, status: 'ACTIVE' });
      if (activeAfter.length !== periods.length) throw new Error('POST_EDIT_INTEGRITY_CHECK_FAILED');
      const updatedGroup = await base44.asServiceRole.entities.Group.get(groupId);
      const updatedProfile = await base44.asServiceRole.entities.OperationalGroupProfile.get(profiles[0].id);
      return Response.json({ success: true, action: 'updated', group: updatedGroup, operational_group_profile: updatedProfile, periods: activeAfter });
    } catch (error) {
      const cleanupErrors = await rollbackEdit(base44, originals, createdPeriodIds);
      return Response.json({ success: false, error: 'EDIT_FAILED', message: error.message, rollback_complete: cleanupErrors.length === 0, rollback_errors: cleanupErrors }, { status: 500 });
    }
  } catch (error) {
    return Response.json({ success: false, error: 'INTERNAL_ERROR', message: error.message || 'Unexpected error' }, { status: 500 });
  }
}