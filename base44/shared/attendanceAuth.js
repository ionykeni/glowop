// Resolves the authenticated caller for attendance functions.
// Identity = Base44-authenticated email -> active InternalUser -> linked active WorkerProfile (all server-side).
import { resolveCaller, resolveOwnWorkerProfile } from './workforceAuth.js';
import { attendanceAccess } from './attendancePolicy.js';

export async function resolveAttendanceCaller(base44, req) {
  const unauthorized = { error: Response.json({ error: 'נדרשת התחברות' }, { status: 401 }) };
  if (!req.headers.get('Authorization')) return unauthorized;
  const me = await base44.auth.me().catch((e) => { const s = e?.status || e?.response?.status; return s === 401 || s === 403 ? null : Promise.reject(e); });
  if (!me?.email) return unauthorized;
  const caller = await resolveCaller(base44);
  if (caller.error) return caller;
  const profile = await resolveOwnWorkerProfile(base44, caller);
  const access = attendanceAccess(caller.role, profile);
  if (!access.canView) return { error: Response.json({ error: 'אין הרשאה לשעון הנוכחות — נדרש פרופיל עובד פעיל המקושר למשתמש' }, { status: 403 }) };
  return { ...caller, profile, access, actorName: profile?.full_name || caller.internalUser.name || caller.email };
}

export const attendanceLockKey = (workerId) => `WORKER|${workerId}`;