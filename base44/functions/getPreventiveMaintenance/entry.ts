import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolvePmCaller, pmJson, pmError } from '../../shared/preventiveMaintenanceAuth.js';
import { buildOverview, buildHistory } from '../../shared/preventiveMaintenanceRead.js';

// Read-only views of the preventive-maintenance module (תחזוקה שוטפת). Never creates or modifies records.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolvePmCaller(base44, req);
    if (caller.error) return caller.error;
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;
    if (body.action === 'overview') return pmJson(await buildOverview(db, caller));
    if (body.action === 'history') return pmJson(await buildHistory(db, caller, body.filters || {}));
    return pmJson({ error: 'פעולה לא מוכרת' }, 400);
  } catch (error) {
    return pmError('getPreventiveMaintenance', error, 'שגיאה פנימית בטעינת הנתונים');
  }
}