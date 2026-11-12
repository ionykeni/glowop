import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { checkWorkerIdentityChange, isWorkerLinkedTo, WORKER_TEAMS } from '../../shared/workforcePolicy.js';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const authUser = await base44.auth.me();
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const callerEmail = normalizeEmail(authUser.email);
    const callers = await base44.asServiceRole.entities.InternalUser.list('-created_date', 500);
    const caller = callers.find((item) => normalizeEmail(item.email) === callerEmail && item.active !== false);
    if (!caller || !['SUPER_ADMIN', 'ADMIN'].includes(caller.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const action = body.action;
    const workers = await base44.asServiceRole.entities.WorkerProfile.list('full_name', 500);

    if (action === 'list') {
      const users = await base44.asServiceRole.entities.InternalUser.list('name', 500);
      const userMap = Object.fromEntries(users.map((item) => [item.id, item]));
      return Response.json({ workers: workers.map((worker) => ({ ...worker, linked_user: worker.internal_user_id ? userMap[worker.internal_user_id] || null : null })) });
    }

    if (action === 'search_user') {
      const email = normalizeEmail(body.email);
      if (!email) return Response.json({ error: 'יש להזין אימייל' }, { status: 400 });
      const users = await base44.asServiceRole.entities.InternalUser.list('name', 500);
      const found = users.find((item) => normalizeEmail(item.email) === email && item.active !== false);
      return Response.json({ user: found ? { id: found.id, name: found.name, email: normalizeEmail(found.email), role: found.role } : null });
    }

    if (action === 'save') {
      const data = body.worker || {};
      const workerId = body.worker_id || '';
      if (!String(data.full_name || '').trim()) return Response.json({ error: 'שם מלא הוא שדה חובה' }, { status: 400 });
      const email = normalizeEmail(data.email);
      let linkedUser = null;
      if (data.internal_user_id) {
        const users = await base44.asServiceRole.entities.InternalUser.list('name', 500);
        linkedUser = users.find((item) => item.id === data.internal_user_id && item.active !== false);
        if (!linkedUser) return Response.json({ error: 'משתמש המערכת אינו פעיל או לא קיים' }, { status: 400 });
      }
      const existingWorker = workerId ? workers.find((item) => item.id === workerId) : null;
      if (workerId && !existingWorker) return Response.json({ error: 'העובד לא נמצא' }, { status: 404 });
      const identityError = checkWorkerIdentityChange({ caller, existingWorker, linkedUser });
      if (identityError) return Response.json({ error: identityError.error }, { status: identityError.status });
      if (data.default_team && !WORKER_TEAMS.includes(data.default_team)) return Response.json({ error: 'צוות לא תקין' }, { status: 400 });
      const linkedEmail = linkedUser ? normalizeEmail(linkedUser.email) : '';
      if (data.is_active !== false && linkedUser) {
        const duplicate = workers.find((item) => item.id !== workerId && item.is_active !== false && (item.internal_user_id === linkedUser.id || normalizeEmail(item.internal_user_email) === linkedEmail));
        if (duplicate) return Response.json({ error: 'המשתמש כבר מקושר לעובד אחר' }, { status: 409 });
      }
      const payload = {
        full_name: String(data.full_name).trim(), phone: String(data.phone || '').trim(), email,
        default_team: data.default_team || 'OTHER', notes: String(data.notes || '').trim(),
        is_active: data.is_active !== false, internal_user_id: linkedUser?.id || '',
        internal_user_email: linkedEmail, updated_by: callerEmail,
      };
      const saved = workerId
        ? await base44.asServiceRole.entities.WorkerProfile.update(workerId, payload)
        : await base44.asServiceRole.entities.WorkerProfile.create({ ...payload, created_by: callerEmail });
      return Response.json({ worker: saved });
    }

    if (action === 'toggle') {
      const worker = workers.find((item) => item.id === body.worker_id);
      if (!worker) return Response.json({ error: 'העובד לא נמצא' }, { status: 404 });
      if (isWorkerLinkedTo(worker, caller)) return Response.json({ error: 'לא ניתן לשנות את סטטוס פרופיל העובד של עצמך' }, { status: 403 });
      const isActive = body.is_active === true;
      if (isActive && worker.internal_user_id) {
        const duplicate = workers.find((item) => item.id !== worker.id && item.is_active !== false && (item.internal_user_id === worker.internal_user_id || normalizeEmail(item.internal_user_email) === normalizeEmail(worker.internal_user_email)));
        if (duplicate) return Response.json({ error: 'המשתמש כבר מקושר לעובד אחר' }, { status: 409 });
      }
      await base44.asServiceRole.entities.WorkerProfile.update(worker.id, { is_active: isActive, updated_by: callerEmail });
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});