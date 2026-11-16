import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { withPmLock } from '../../shared/preventiveMaintenanceLock.js';
import { israelDate } from '../../shared/preventiveMaintenanceDates.js';
import { generateOccurrences } from '../../shared/preventiveMaintenanceGenerate.js';

// Called by the scheduled workflow. Ensures each active WEEKLY/MONTHLY task has its current (and any missed,
// bounded) Israel-local period occurrence. Idempotent via deterministic occurrence_key + module lock.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 || e.status === 403 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const db = base44.asServiceRole.entities;
    const res = await withPmLock(db, () => generateOccurrences(db, israelDate(), 'SCHEDULED'));
    if (res.busy) return Response.json({ success: false, busy: true }, { status: 409 });
    return Response.json({ success: true, ...res.value });
  } catch (error) {
    console.error('[generateMaintenanceOccurrences]', error?.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}