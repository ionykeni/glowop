import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { analyzeActiveMultiPeriodStayChange, authorizeActiveStayAdmin } from '../../shared/activeMultiPeriodStayChange.js';
import { todayIL } from '../../shared/stayReconciliationCore.js';

function startedPeriodBlockers(currentPeriods, proposedPeriods, today) {
  const proposedById = new Map(proposedPeriods.filter(period => period.id).map(period => [period.id, period]));
  return currentPeriods.flatMap(current => {
    const isStarted = current.start_date < today && current.end_date > today;
    if (!isStarted) return [];
    const proposed = proposedById.get(current.id);
    if (proposed && proposed.start_date === current.start_date && proposed.end_date >= today) return [];
    return [{
      code: 'STARTED_PERIOD_CANNOT_BE_REMOVED_OR_REWRITTEN',
      period_id: current.id,
      current_start_date: current.start_date,
      current_end_date: current.end_date,
      proposed_exists: !!proposed,
      proposed_start_date: proposed?.start_date || null,
      proposed_end_date: proposed?.end_date || null,
      today,
    }];
  });
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    if (!await authorizeActiveStayAdmin(base44, user)) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });
    const { group_id, periods } = await req.json().catch(() => ({}));
    if (!group_id || !Array.isArray(periods)) return Response.json({ success: false, error: 'GROUP_ID_AND_PERIODS_REQUIRED' }, { status: 400 });

    const today = todayIL();
    const currentPeriods = await base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id, status: 'ACTIVE' }, 'start_date', 100);
    const explicitStartedBlockers = startedPeriodBlockers(currentPeriods, periods, today);
    const { result } = await analyzeActiveMultiPeriodStayChange(base44, group_id, periods, today);
    const otherBlockers = (result.blocking_errors || []).filter(blocker => blocker.code !== 'STARTED_PERIOD_CANNOT_BE_REMOVED_OR_REWRITTEN');
    const blockingErrors = [...otherBlockers, ...explicitStartedBlockers];
    return Response.json({ ...result, allowed: blockingErrors.length === 0, blocking_errors: blockingErrors });
  } catch (error) {
    return Response.json({ success: false, error: 'PREVIEW_FAILED', message: error.message }, { status: 500 });
  }
}