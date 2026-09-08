import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { analyzeActiveMultiPeriodStayChange, authorizeActiveStayAdmin } from '../../shared/activeMultiPeriodStayChange.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    if (!await authorizeActiveStayAdmin(base44, user)) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });
    const { group_id, periods } = await req.json().catch(() => ({}));
    if (!group_id || !Array.isArray(periods)) return Response.json({ success: false, error: 'GROUP_ID_AND_PERIODS_REQUIRED' }, { status: 400 });
    const { result } = await analyzeActiveMultiPeriodStayChange(base44, group_id, periods);
    const blockingErrors = Array.isArray(result.blocking_errors)
      ? result.blocking_errors.map(blocker => blocker?.code === 'STARTED_PERIOD_CANNOT_BE_REMOVED_OR_REWRITTEN'
        ? { ...blocker, runtime_entry_confirmed: true }
        : blocker)
      : result.blocking_errors;
    return Response.json({ ...result, blocking_errors: blockingErrors, diagnostic_version: 'preview-entry-v3' });
  } catch (error) {
    return Response.json({ success: false, error: 'PREVIEW_FAILED', message: error.message }, { status: 500 });
  }
}