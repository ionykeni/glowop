// Resolves the authenticated caller for preventive-maintenance functions.
// Identity = Base44-authenticated email -> active InternalUser -> linked active WorkerProfile (all server-side).
import { resolveCaller, resolveOwnWorkerProfile } from './workforceAuth.js';
import { pmAccess } from './preventiveMaintenancePolicy.js';

export async function resolvePmCaller(base44, req) {
  const unauthorized = { error: Response.json({ error: 'נדרשת התחברות' }, { status: 401 }) };
  if (!req.headers.get('Authorization')) return unauthorized;
  const me = await base44.auth.me().catch((e) => { const s = e?.status || e?.response?.status; return s === 401 || s === 403 ? null : Promise.reject(e); });
  if (!me?.email) return unauthorized;
  const caller = await resolveCaller(base44);
  if (caller.error) return caller;
  const profile = await resolveOwnWorkerProfile(base44, caller);
  const access = pmAccess(caller.role, profile);
  if (!access.canView) return { error: Response.json({ error: 'אין הרשאה למודול תחזוקה שוטפת' }, { status: 403 }) };
  return { ...caller, profile, access, actorName: profile?.full_name || caller.internalUser.name || caller.email };
}

export const pmJson = (body, status = 200) => Response.json(body, { status });
// Unexpected failure: platform throttling is reported as a retryable 429, anything else as a 500.
export function pmError(tag, error, message) {
  const status = error?.status || error?.response?.status;
  console.error(`[${tag}]`, status, error?.message);
  if (status === 429) return pmJson({ error: 'עומס זמני במערכת — נסה שוב בעוד רגע', retryable: true }, 429);
  return pmJson({ error: message }, 500);
}
export const pmResult = (res) => {
  if (res.busy) return pmJson({ error: 'פעולה אחרת מתבצעת כעת — נסה שוב בעוד רגע', retryable: true }, 409);
  const v = res.value;
  if (v?.error) return pmJson({ error: v.error }, v.status || 400);
  return pmJson({ success: true, ...v });
};