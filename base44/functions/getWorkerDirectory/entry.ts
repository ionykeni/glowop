import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveCaller, requireRole, resolveOwnWorkerProfile } from '../../shared/workforceAuth.js';
import { SCHEDULE_MANAGER_ROLES } from '../../shared/workforcePolicy.js';

// Minimum-data WorkerProfile lookups. Never returns email, notes or system-user links.
//  me         — any active internal user: own active profile {id, full_name, default_team} or null
//  names      — any active internal user except MECHINA_USER: {id, full_name} for up to 100 given ids
//  scheduling — schedule managers: active workers {id, full_name, default_team, phone, is_linked}
//               (phone is used by the manager-only personal weekly message)
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveCaller(base44);
    if (caller.error) return caller.error;
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities.WorkerProfile;

    if (body.action === 'me') {
      const p = await resolveOwnWorkerProfile(base44, caller);
      return Response.json({ profile: p ? { id: p.id, full_name: p.full_name, default_team: p.default_team || 'OTHER' } : null });
    }

    if (body.action === 'names') {
      if (caller.role === 'MECHINA_USER') return Response.json({ error: 'Forbidden' }, { status: 403 });
      const ids = [...new Set((Array.isArray(body.worker_ids) ? body.worker_ids : []).map(String).filter(Boolean))].slice(0, 100);
      if (!ids.length) return Response.json({ workers: [] });
      const rows = await db.filter({ id: { $in: ids } });
      return Response.json({ workers: rows.map((p) => ({ id: p.id, full_name: p.full_name })) });
    }

    if (body.action === 'scheduling') {
      const denied = requireRole(caller, SCHEDULE_MANAGER_ROLES);
      if (denied) return denied;
      const rows = await db.filter({ is_active: true }, 'full_name', 500);
      return Response.json({ workers: rows.map((p) => ({ id: p.id, full_name: p.full_name, default_team: p.default_team || 'OTHER', phone: p.phone || '', is_linked: !!p.internal_user_id })) });
    }

    return Response.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}