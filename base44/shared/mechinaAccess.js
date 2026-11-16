// Email-normalized identity checks for the Mechina modules (pure; no SDK).
// Legacy InternalUser / MechinaGroupAssignment rows may keep the casing they were typed with,
// while the authenticated email is lowercase — every comparison goes through normalizeEmail.
import { normalizeEmail, pickActiveInternalUser } from './workforcePolicy.js';
import { resolveCaller, requireRole } from './workforceAuth.js';

export const REPORT_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'];

// Active (active === true) InternalUser row for the email; conflicting active roles fail closed (null).
export function resolveActiveInternalUser(rows, email) {
  return pickActiveInternalUser((rows || []).filter((r) => r.active === true), email).user || null;
}

export function assignmentsForEmail(assignments, email) {
  const target = normalizeEmail(email);
  if (!target) return [];
  return (assignments || []).filter((a) => a.is_active !== false && normalizeEmail(a.user_email) === target);
}

// Same decision rules as the former mechinaSleepingReport.authorize, with normalized matching.
export function reportAccess({ internal, assignments, email, groupId }) {
  const role = internal?.role || null;
  const isAdmin = REPORT_ADMIN_ROLES.includes(role);
  if (!groupId) return { isAdmin, allowed: isAdmin };
  if (isAdmin) return { isAdmin, allowed: true };
  if (role !== 'MECHINA_USER') return { isAdmin, allowed: false };
  return { isAdmin, allowed: assignmentsForEmail(assignments, email).some((a) => a.group_id === groupId) };
}

// The signed-in MECHINA_USER's own active assignments (minimum fields for the Mechina spaces page).
export async function handleMyMechinaAssignments(base44) {
  const caller = await resolveCaller(base44);
  if (caller.error) return caller.error;
  const denied = requireRole(caller, ['MECHINA_USER']);
  if (denied) return denied;
  const rows = await base44.asServiceRole.entities.MechinaGroupAssignment.filter({ is_active: true }, '-created_date', 1000);
  return Response.json({ assignments: assignmentsForEmail(rows, caller.email).map((a) => ({ id: a.id, group_id: a.group_id, group_name: a.group_name || '', is_active: true })) });
}