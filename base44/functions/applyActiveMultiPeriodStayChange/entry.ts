import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { analyzeActiveMultiPeriodStayChange, authorizeActiveStayAdmin } from '../../shared/activeMultiPeriodStayChange.js';
import { executeStayChange } from '../../shared/stayChangeExecution.js';

async function storePlan(base44, plan, requestId) {
  const file = new File(
    [JSON.stringify(plan)],
    `active-stay-change-${requestId}.json`,
    { type: 'application/json' },
  );
  const uploaded = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
  return uploaded.file_uri;
}

async function loadPlan(base44, planUri) {
  const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
    file_uri: planUri,
    expires_in: 300,
  });
  const response = await fetch(signed.signed_url);
  if (!response.ok) throw new Error('STORED_EXECUTION_PLAN_UNAVAILABLE');
  return await response.json();
}

function withSleepingReconciliation(plan, result, actions) {
  const existingKeys = new Set(plan.impacts.map(impact => impact.key));
  const missingCoverage = actions.extend_sleeping === true ? result.sleeping_missing : result.sleeping_missing_if_deferred;
  const sleepingImpacts = (missingCoverage || []).map(item => ({
    key: `SLEEPING:MISSING_COVERAGE:${item.date}:${item.stay_period_id || ''}`,
    module: 'SLEEPING',
    impact_type: 'MISSING_COVERAGE',
    date: item.date,
    summary: item.summary,
    metadata: item,
    action: null,
  })).filter(impact => !existingKeys.has(impact.key));
  return { ...plan, impacts: [...plan.impacts, ...sleepingImpacts] };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    if (!await authorizeActiveStayAdmin(base44, user)) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });

    const { group_id, periods, confirmed, request_id, base_version, actions = {} } = await req.json().catch(() => ({}));
    if (!group_id || !Array.isArray(periods) || confirmed !== true || !request_id || !base_version || !actions || typeof actions !== 'object' || Array.isArray(actions)) {
      return Response.json({ success: false, error: 'CONFIRMED_CHANGE_CONTEXT_REQUIRED' }, { status: 400 });
    }

    const db = base44.asServiceRole.entities;
    const existingRows = await db.OperationalStayChange.filter({ group_id, request_id }, '-created_date', 1);
    let change = existingRows[0];
    let plan;

    if (change) {
      plan = await loadPlan(base44, change.plan_uri);
      if (plan.base_version !== base_version) {
        return Response.json({ success: false, error: 'REQUEST_VERSION_MISMATCH' }, { status: 409 });
      }
    } else {
      const analyzed = await analyzeActiveMultiPeriodStayChange(base44, group_id, periods);
      if (!analyzed.result.allowed) {
        return Response.json({ success: false, error: 'CHANGE_BLOCKED_AFTER_FRESH_PREVIEW', preview: analyzed.result }, { status: 409 });
      }
      if (analyzed.result.base_version !== base_version) {
        return Response.json({ success: false, error: 'PREVIEW_VERSION_STALE', preview: analyzed.result }, { status: 409 });
      }

      plan = withSleepingReconciliation(analyzed.plan, analyzed.result, actions);
      const planUri = await storePlan(base44, plan, request_id);
      change = await db.OperationalStayChange.create({
        group_id,
        request_id,
        plan_uri: planUri,
        state: 'PREPARED',
        requested_by: user.email,
      });
    }

    const result = await executeStayChange(base44, change, plan, actions, user.email);
    return Response.json(result, { status: result.success ? 200 : 409 });
  } catch (error) {
    return Response.json({ success: false, error: 'APPLY_FAILED', message: error.message }, { status: 500 });
  }
}