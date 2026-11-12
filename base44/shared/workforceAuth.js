// Server-side caller resolution for workforce functions.
// Identity = the Base44-authenticated email only; role = the matching active InternalUser row (service-role read).
// No platform-role fallback and no testing-flag bypass.
import { normalizeEmail, pickActiveInternalUser } from './workforcePolicy.js';

const json = (body, status) => Response.json(body, { status });

export async function resolveCaller(base44) {
  const authUser = await base44.auth.me().catch((e) => ((e?.status || e?.response?.status) === 401 ? null : Promise.reject(e)));
  if (!authUser?.email) return { error: json({ error: 'Unauthorized' }, 401) };
  const users = await base44.asServiceRole.entities.InternalUser.list('-created_date', 1000);
  const { user, conflict } = pickActiveInternalUser(users, authUser.email);
  if (conflict) return { error: json({ error: 'זהות המשתמש אינה חד-משמעית. פנה למנהל המערכת.' }, 403) };
  if (!user) return { error: json({ error: 'Forbidden' }, 403) };
  return { email: normalizeEmail(authUser.email), internalUser: user, role: user.role, users };
}

export function requireRole(caller, roles) {
  return roles.includes(caller.role) ? null : json({ error: 'Forbidden' }, 403);
}

// The caller's own ACTIVE WorkerProfile (by internal_user_id first, then confirmed internal_user_email).
export async function resolveOwnWorkerProfile(base44, caller) {
  const db = base44.asServiceRole.entities.WorkerProfile;
  if (caller.internalUser?.id) {
    const byId = await db.filter({ internal_user_id: caller.internalUser.id });
    const hit = byId.find((p) => p.is_active !== false);
    if (hit) return hit;
  }
  const byEmail = await db.filter({ internal_user_email: caller.email });
  return byEmail.find((p) => p.is_active !== false) || null;
}