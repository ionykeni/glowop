const LEGACY_RESTRICTED_CODES = new Set(['bunker_2', 'bunker_3', 'bunker_4', 'bunker_5', 'dining_hall']);
const LEGACY_HIDDEN_CODES = new Set(['bunker_5', 'dining_hall']);
export const MECHINA_DISABLED_REASON = 'המרחב חסום לבקשות מכינה חדשות על ידי מנהל המערכת';

export function isMechinaRequestsEnabled(space) {
  if (!space) return false;
  if (typeof space.mechina_requests_enabled === 'boolean') return space.mechina_requests_enabled;
  return !LEGACY_RESTRICTED_CODES.has(space.code);
}

export function presentMechinaSpace(space) {
  return { ...space, mechina_requests_effective_enabled: isMechinaRequestsEnabled(space),
    mechina_requests_visible: space.mechina_requests_enabled === true || !LEGACY_HIDDEN_CODES.has(space.code) };
}

export function mechinaRejectionDecision(user, internalUser) {
  return { status: 'REJECTED', admin_notes: MECHINA_DISABLED_REASON,
    admin_decision_at: new Date().toISOString(), admin_decision_by_user_id: user.id,
    admin_decision_by_name: internalUser?.name || user.full_name || user.email };
}

// Conditional writes protect already-approved requests, including concurrent status changes.
// No schedule items, closures or previously decided requests are written here.
export async function rejectPendingMechinaRequests(base44, spaceId, user, internalUser, requestId = null) {
  const query = { space_id: spaceId, status: 'PENDING', ...(requestId ? { id: requestId } : {}) };
  const decision = mechinaRejectionDecision(user, internalUser);
  for (let batch = 0; batch < 20; batch++) {
    const result = await base44.asServiceRole.entities.CommonSpaceBookingRequest.updateMany(query, { $set: decision });
    if (!result.has_more) break;
  }
  return await base44.asServiceRole.entities.CommonSpaceBookingRequest.count(query);
}