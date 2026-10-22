import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { deriveStayEnvelope, validateStayPeriods } from '../../shared/groupStayPeriods.js';

const ALLOWED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

function conflict(error, details = {}) {
  return Response.json({ success: false, error, ...details }, { status: 409 });
}

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email }, '-created_date', 1);
    const role = internalUsers[0]?.role || user.role;
    if (!ALLOWED_ROLES.has(role)) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });

    const { group_id } = await req.json().catch(() => ({}));
    if (!group_id) return Response.json({ success: false, error: 'MISSING_GROUP_ID' }, { status: 400 });

    const [groups, profiles, activePeriods] = await Promise.all([
      base44.asServiceRole.entities.Group.filter({ id: group_id }),
      base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id }),
      base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id, status: 'ACTIVE' }),
    ]);
    const group = groups[0];
    if (!group) return Response.json({ success: false, error: 'GROUP_NOT_FOUND' }, { status: 404 });
    if (group.stay_mode !== 'MULTI_PERIOD') return conflict('NOT_MULTI_PERIOD');
    if (group.quote_preparation_flow !== false) return conflict('QUOTE_PREPARATION_FLOW_CONFLICT');
    if (profiles.length !== 1) return conflict('EXPECTED_EXACTLY_ONE_OGP', { profile_count: profiles.length });
    if (activePeriods.length < 2) return conflict('MIN_TWO_ACTIVE_PERIODS', { active_period_count: activePeriods.length });

    const validation = validateStayPeriods(activePeriods);
    if (!validation.valid) return conflict('INVALID_PERIODS', { validation });
    const envelope = deriveStayEnvelope(activePeriods);
    if (!envelope || group.arrival_date !== envelope.start_date || group.departure_date !== envelope.end_date) {
      return conflict('GROUP_ENVELOPE_MISMATCH', { expected_envelope: envelope });
    }

    const profile = profiles[0];
    const alreadyActivated = group.status === 'CONFIRMED' && group.operationally_active === true && profile.status === 'ACCEPTED';
    if (alreadyActivated) return Response.json({ success: true, status: 'already_activated', group, operational_group_profile: profile, periods: activePeriods });
    if (group.status !== 'DRAFT' || group.operationally_active !== false) {
      return conflict('ACTIVATION_STATE_CONFLICT', { group_status: group.status, operationally_active: group.operationally_active, profile_status: profile.status });
    }

    const groupSnapshot = { status: group.status, operationally_active: group.operationally_active };
    const profileSnapshot = { status: profile.status };
    let updatedGroup;
    try {
      updatedGroup = await base44.asServiceRole.entities.Group.update(group.id, { status: 'CONFIRMED', operationally_active: true });
    } catch (error) {
      return Response.json({ success: false, error: 'GROUP_ACTIVATION_UPDATE_FAILED', message: error.message }, { status: 500 });
    }

    let updatedProfile;
    try {
      updatedProfile = await base44.asServiceRole.entities.OperationalGroupProfile.update(profile.id, { status: 'ACCEPTED' });
    } catch (error) {
      try {
        await base44.asServiceRole.entities.Group.update(group.id, groupSnapshot);
      } catch (rollbackError) {
        return Response.json({ success: false, error: 'PARTIAL_FAILURE_ROLLBACK_FAILED', message: error.message, rollback_error: rollbackError.message }, { status: 500 });
      }
      return Response.json({ success: false, error: 'ACTIVATION_FAILED_ROLLED_BACK', message: error.message, restored_group: groupSnapshot, profile_unchanged: profileSnapshot }, { status: 500 });
    }

    return Response.json({ success: true, status: 'activated', group: updatedGroup, operational_group_profile: updatedProfile, periods: activePeriods });
  } catch (error) {
    return Response.json({ success: false, error: 'INTERNAL_ERROR', message: error.message || 'Unexpected error' }, { status: 500 });
  }
}