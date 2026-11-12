import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveCaller, requireRole } from '../../shared/workforceAuth.js';
import { USER_MANAGER_ROLES, planInternalUserSave, planInternalUserActive } from '../../shared/workforcePolicy.js';

// User management (SUPER_ADMIN only): list, create/edit, activate/deactivate InternalUser rows.
const toItem = (u) => ({ id: u.id, email: u.email, name: u.name || '', role: u.role, active: u.active !== false, phone: u.phone || '', notes: u.notes || '', created_date: u.created_date });

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveCaller(base44);
    if (caller.error) return caller.error;
    const denied = requireRole(caller, USER_MANAGER_ROLES);
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities.InternalUser;

    if (body.action === 'list') return Response.json({ users: caller.users.map(toItem) });

    if (body.action === 'save' || body.action === 'set_active') {
      const plan = body.action === 'save'
        ? planInternalUserSave({ caller: caller.internalUser, users: caller.users, userId: body.user_id || '', input: body.user || {} })
        : planInternalUserActive({ caller: caller.internalUser, users: caller.users, userId: body.user_id || '', active: body.active });
      if (plan.error) return Response.json({ error: plan.error }, { status: plan.status });
      const saved = plan.action === 'create' ? await db.create(plan.data) : await db.update(plan.id, plan.data);
      console.log('[manageInternalUsers]', JSON.stringify({ by: caller.email, action: body.action, target: saved.id, before: plan.before || null, after: { role: saved.role, active: saved.active } }));
      return Response.json({ user: toItem(saved) });
    }

    return Response.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}