import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveCaller, requireRole } from '../../shared/workforceAuth.js';
import { MECHINA_USER_MANAGER_ROLES, planMechinaUser, normalizeEmail, boundedText } from '../../shared/workforcePolicy.js';

// Mechina users of one group: list assignments, assign a MECHINA_USER, (de)activate an assignment.
// Never grants or changes any role other than MECHINA_USER.
const toItem = (a) => ({ id: a.id, group_id: a.group_id, user_email: a.user_email, user_name: a.user_name || '', is_active: a.is_active !== false, notes: a.notes || '', created_date: a.created_date });
const notFound = (e) => ((e?.status || e?.response?.status) === 404 ? null : Promise.reject(e));

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveCaller(base44);
    if (caller.error) return caller.error;
    const denied = requireRole(caller, MECHINA_USER_MANAGER_ROLES);
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const sr = base44.asServiceRole.entities;

    if (body.action === 'list_assignments' || body.action === 'assign') {
      const group = body.group_id ? await sr.Group.get(String(body.group_id)).catch(notFound) : null;
      if (!group) return Response.json({ error: 'הקבוצה לא נמצאה' }, { status: 404 });
      const assignments = await sr.MechinaGroupAssignment.filter({ group_id: group.id }, '-created_date', 500);
      if (body.action === 'list_assignments') return Response.json({ assignments: assignments.map(toItem) });

      const plan = planMechinaUser({ caller: caller.internalUser, users: caller.users, email: body.email, name: body.name });
      if (plan.error) return Response.json({ error: plan.error }, { status: plan.status });
      const notes = boundedText(body.notes, 500);
      if (notes === null) return Response.json({ error: 'ההערות ארוכות מדי' }, { status: 400 });

      const user = plan.action === 'create' ? await sr.InternalUser.create(plan.data) : await sr.InternalUser.update(plan.id, plan.data);
      const email = normalizeEmail(user.email);
      const existing = assignments.find((a) => normalizeEmail(a.user_email) === email);
      const assignment = existing
        ? await sr.MechinaGroupAssignment.update(existing.id, { user_name: plan.data.name || existing.user_name || '', is_active: true, notes })
        : await sr.MechinaGroupAssignment.create({ user_email: email, user_name: plan.data.name, group_id: group.id, group_name: group.group_name || '', is_active: true, notes });
      console.log('[manageMechinaUsers]', JSON.stringify({ by: caller.email, action: 'assign', user: user.id, user_action: plan.action, group: group.id, assignment: assignment.id }));
      return Response.json({ assignment: toItem(assignment) });
    }

    if (body.action === 'set_assignment_active') {
      if (typeof body.is_active !== 'boolean') return Response.json({ error: 'ערך לא תקין' }, { status: 400 });
      const assignment = body.assignment_id ? await sr.MechinaGroupAssignment.get(String(body.assignment_id)).catch(notFound) : null;
      if (!assignment) return Response.json({ error: 'השיוך לא נמצא' }, { status: 404 });
      const saved = await sr.MechinaGroupAssignment.update(assignment.id, { is_active: body.is_active });
      console.log('[manageMechinaUsers]', JSON.stringify({ by: caller.email, action: 'set_assignment_active', assignment: assignment.id, is_active: body.is_active }));
      return Response.json({ assignment: toItem(saved) });
    }

    return Response.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}