import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { todayIL } from '../../shared/stayReconciliationCore.js';
import { RELEASE_SPEC, findLiveCommitments, releaseRow } from '../../shared/quoteCancellationRelease.js';

// B2 commit. Authorization + full revalidation via the read-only preview (same caller token).
// Concurrency: atomic compare-and-set locks (updateMany filtered on cancellation_operation_id = null) on the
// Quote, then the Group. Recovery: any later call for a locked Quote resumes the owning operation; every
// resource release is a conditional, idempotent update. Group.status becomes CANCELLED only after a full
// re-read verifies zero live commitments. Calendar cleanup is a separate, retryable step.
const REASONS = new Set(['CUSTOMER_CANCELLED', 'CREATED_BY_MISTAKE']);
const PAGE = 500;
const SWEEP_ROUNDS = 5;

const MESSAGES = {
  ACTUAL_STAY_EVIDENCE: 'קיימים רישומים שמעידים על שהייה בפועל. נדרשת בדיקה תפעולית.',
  NO_ARRIVAL_DECLARATION_REQUIRED: 'יש לאשר שהקבוצה לא הגיעה.',
  STALE: 'הנתונים השתנו מאז הפתיחה. יש לפתוח מחדש.',
  DISABLED: 'הפעולה עדיין אינה זמינה.',
  MULTI_PERIOD: 'קבוצה עם תקופות שהייה מרובות דורשת בדיקה תפעולית.',
  AMBIGUOUS: 'הקשר בין ההצעה לקבוצה אינו חד-משמעי. נדרשת בדיקה.',
  SHARED: 'לקבוצה פעילות משותפת עם קבוצה אחרת. נדרשת בדיקה תפעולית.',
  IN_PROGRESS: 'פעולת ביטול אחרת מתבצעת כעת עבור הצעה זו.',
  BLOCKED: 'לא ניתן לבצע כרגע. נדרשת בדיקה תפעולית.',
  RECOVERY: 'הביטול לא הושלם. ניתן לנסות שוב להשלמה.',
  DONE_CUSTOMER: 'ההזמנה בוטלה והמשאבים שוחררו.',
  DONE_MISTAKE: 'ההצעה הוסרה כ"נוצרה בטעות".',
  CALENDAR_PENDING: 'אירועי היומן טרם הוסרו; ניתן לנסות שוב.',
};
const messageFor = blockers => blockers.includes('ACTUAL_STAY_EVIDENCE') ? MESSAGES.ACTUAL_STAY_EVIDENCE
  : blockers.includes('CANCELLATION_IN_PROGRESS') ? MESSAGES.IN_PROGRESS
  : blockers.includes('MULTI_PERIOD_NOT_SUPPORTED_IN_INITIAL_SCOPE') ? MESSAGES.MULTI_PERIOD
  : blockers.some(b => b === 'FUTURE_SHARED_ACTIVITY' || b === 'SHARED_ACTIVITY_OWNERSHIP_AMBIGUOUS') ? MESSAGES.SHARED
  : blockers.some(b => /QUOTE|OWNERSHIP|RELATIONSHIP|PROFILES|GROUP_NOT_FOUND|NO_GROUP/.test(b)) ? MESSAGES.AMBIGUOUS
  : MESSAGES.BLOCKED;

async function readAll(entity, query) {
  const rows = []; const seen = new Set();
  for (let skip = 0; ; skip += PAGE) {
    const page = await entity.filter(query, 'id', PAGE, skip);
    if (!Array.isArray(page)) throw new Error('READ_FAILED');
    for (const r of page) { if (seen.has(r.id)) throw new Error('READ_INCONSISTENT'); seen.add(r.id); rows.push(r); }
    if (page.length < PAGE) return rows;
  }
}
const parse = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// Release everything still live for the Group until a full re-read is empty twice; then verify and finalize.
async function runEngine(base44, db, audit) {
  const progress = parse(audit.progress_json);
  progress.released = progress.released || {};
  const calendarIds = new Set(parse(audit.calendar_item_ids_json).ids || []);
  const save = patch => db.QuoteCancellationAudit.update(audit.id, { progress_json: JSON.stringify(progress), calendar_item_ids_json: JSON.stringify({ ids: [...calendarIds] }), ...patch });
  try {
    const gid = audit.group_id;
    if (gid) {
      const today = todayIL();
      // Fence: removes the Group from operational modules while releasing (isGroupOperationallyEnabled).
      await db.Group.updateMany({ id: gid, cancellation_operation_id: audit.id }, { $set: { operationally_active: false } });
      let emptyRounds = 0;
      for (let round = 0; round < SWEEP_ROUNDS && emptyRounds < 2; round++) {
        const live = await findLiveCommitments(db, gid, today, readAll);
        const total = Object.values(live).reduce((n, rows) => n + rows.length, 0);
        if (!total) { emptyRounds++; continue; }
        emptyRounds = 0;
        for (const spec of RELEASE_SPEC) {
          for (const row of live[spec.key]) {
            if (await releaseRow(db, spec, row)) progress.released[spec.key] = (progress.released[spec.key] || 0) + 1;
            if (spec.key === 'schedule_items') calendarIds.add(row.id);
          }
        }
        await save({ state: 'IN_PROGRESS' });
      }
      if (emptyRounds < 2) throw Object.assign(new Error('LIVE_COMMITMENTS_REMAIN'), { code: 'LIVE_COMMITMENTS_REMAIN' });
      const g = await db.Group.updateMany({ id: gid, cancellation_operation_id: audit.id }, { $set: { status: 'CANCELLED' } });
      const group = (await db.Group.filter({ id: gid }))[0];
      if (group?.status !== 'CANCELLED' || group.cancellation_operation_id !== audit.id) throw Object.assign(new Error('GROUP_FINALIZE_FAILED'), { code: 'GROUP_FINALIZE_FAILED', updated: g?.updated });
      // Final sweep after CANCELLED (write-fence protocol, shared/groupWriteGuard.js): catches any guarded write
      // whose post-write re-read saw the lock but not yet CANCELLED.
      let clean = false;
      for (let round = 0; round < SWEEP_ROUNDS && !clean; round++) {
        const live = await findLiveCommitments(db, gid, today, readAll);
        clean = Object.values(live).every(rows => rows.length === 0);
        for (const spec of RELEASE_SPEC) for (const row of live[spec.key]) {
          if (await releaseRow(db, spec, row)) progress.released[spec.key] = (progress.released[spec.key] || 0) + 1;
          if (spec.key === 'schedule_items') calendarIds.add(row.id);
        }
      }
      if (!clean) throw Object.assign(new Error('LIVE_COMMITMENTS_REMAIN_AFTER_FINALIZE'), { code: 'LIVE_COMMITMENTS_REMAIN_AFTER_FINALIZE' });
    }
    if (audit.reason === 'CREATED_BY_MISTAKE') {
      await db.Quote.updateMany({ id: audit.quote_id, cancellation_operation_id: audit.id }, { $set: { withdrawn_reason: 'CREATED_BY_MISTAKE', withdrawn_at: new Date().toISOString(), withdrawn_by: audit.actor_email } });
      const q = (await db.Quote.filter({ id: audit.quote_id }))[0];
      if (q?.withdrawn_reason !== 'CREATED_BY_MISTAKE') throw Object.assign(new Error('QUOTE_FINALIZE_FAILED'), { code: 'QUOTE_FINALIZE_FAILED' });
    }
    const calendar_state = calendarIds.size ? 'PENDING' : 'NOT_REQUIRED';
    await save({ state: 'COMPLETED', completed_at: new Date().toISOString(), calendar_state, error_code: null, result_message: audit.reason === 'CREATED_BY_MISTAKE' ? MESSAGES.DONE_MISTAKE : MESSAGES.DONE_CUSTOMER });
    return { ok: true, progress, calendarIds: [...calendarIds] };
  } catch (e) {
    await save({ state: 'RECOVERY_REQUIRED', error_code: e?.code || String(e?.message || 'ENGINE_FAILED').slice(0, 120) });
    return { ok: false, error: e?.code || 'ENGINE_FAILED' };
  }
}

async function runCalendar(base44, db, auditId, ids) {
  if (!ids.length) return 'NOT_REQUIRED';
  const res = await base44.functions.invoke('cleanupGroupCalendarSync', { schedule_item_ids: ids }).then(r => r.data, () => null);
  const state = res?.success ? 'DONE' : 'FAILED';
  await db.QuoteCancellationAudit.update(auditId, { calendar_state: state });
  return state;
}

async function finish(base44, db, audit) {
  const engine = audit.state === 'COMPLETED' ? { ok: true } : await runEngine(base44, db, audit);
  const fresh = await db.QuoteCancellationAudit.get(audit.id);
  if (!engine.ok) return Response.json({ success: false, outcome: 'RECOVERY_REQUIRED', operation_id: audit.id, error: engine.error, message: MESSAGES.RECOVERY });
  let calendar = fresh.calendar_state || 'NOT_REQUIRED';
  if (calendar === 'PENDING' || calendar === 'FAILED') calendar = await runCalendar(base44, db, audit.id, parse(fresh.calendar_item_ids_json).ids || []);
  return Response.json({
    success: true, outcome: 'COMPLETED', operation_id: audit.id, reason: audit.reason, calendar_state: calendar,
    released: parse(fresh.progress_json).released || {},
    message: fresh.result_message + (calendar === 'FAILED' ? ` ${MESSAGES.CALENDAR_PENDING}` : ''),
  });
}

export default async function(req) {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  const db = base44.asServiceRole.entities;

  const body = await req.json().catch(() => ({}));
  const quoteId = typeof body.quote_id === 'string' ? body.quote_id.trim() : '';
  const reason = body.reason;
  const key = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
  if (!quoteId || !REASONS.has(reason) || key.length < 8 || key.length > 100) return Response.json({ success: false, error: 'INVALID_REQUEST' }, { status: 400 });

  const invokePreview = operation_id => base44.functions.invoke('previewQuoteBookingCancellation', { quote_id: quoteId, operation_id })
    .then(r => r.data, e => e?.response?.data || null);

  // Authorization (active QUOTES_MANAGER / SUPER_ADMIN only) always runs first, inside the preview.
  const quoteNow = (await db.Quote.filter({ id: quoteId }))[0];
  if (!quoteNow) return Response.json({ success: false, error: 'QUOTE_NOT_FOUND' }, { status: 404 });
  const authPreview = await invokePreview(quoteNow.cancellation_operation_id || undefined);
  if (!authPreview?.success) return Response.json({ success: false, error: authPreview?.error || 'FORBIDDEN' }, { status: 403 });

  // Recovery / idempotent repeat: a locked Quote is owned by exactly one operation; resume or report it.
  if (quoteNow.cancellation_operation_id) {
    const owner = (await db.QuoteCancellationAudit.filter({ id: quoteNow.cancellation_operation_id }))[0];
    if (owner && ['IN_PROGRESS', 'RECOVERY_REQUIRED', 'COMPLETED'].includes(owner.state)) return finish(base44, db, owner);
    return Response.json({ success: false, outcome: 'BLOCKED', message: MESSAGES.BLOCKED });
  }

  const preview = authPreview;
  if (body.fingerprint !== preview.fingerprint) return Response.json({ success: false, outcome: 'STALE', message: MESSAGES.STALE });
  const rule = preview.reasons?.[reason];
  if (!rule) return Response.json({ success: false, outcome: 'BLOCKED', message: MESSAGES.BLOCKED });
  if (rule.blockers?.length) return Response.json({ success: false, outcome: 'BLOCKED', blockers: rule.blockers, message: messageFor(rule.blockers) });
  if (rule.requires_no_arrival_declaration && body.no_arrival_declared !== true) return Response.json({ success: false, outcome: 'BLOCKED', error: 'NO_ARRIVAL_DECLARATION_REQUIRED', message: MESSAGES.NO_ARRIVAL_DECLARATION_REQUIRED });
  if (!preview.commit_enabled) return Response.json({ success: false, outcome: 'DISABLED', message: MESSAGES.DISABLED, validated: true });

  const gid = preview.group?.id || null;
  const audit = await db.QuoteCancellationAudit.create({
    quote_id: quoteId, group_id: gid || undefined, reason, actor_email: user.email, actor_user_id: user.id, actor_role: preview.caller_role,
    no_arrival_declared: body.no_arrival_declared === true, declared_at: body.no_arrival_declared === true ? new Date().toISOString() : undefined,
    planned_arrival_date: preview.group?.arrival_date || undefined, fingerprint: preview.fingerprint, idempotency_key: key, state: 'RECORDED',
    evidence_assessment_json: JSON.stringify({ stay_evidence: preview.stay_evidence || null, possible_stay_signals: preview.possible_stay_signals || [], today: preview.today || null }),
  });
  const block = async (code, outcome = 'BLOCKED', message = MESSAGES.BLOCKED) => {
    await db.QuoteCancellationAudit.update(audit.id, { state: 'BLOCKED', error_code: code });
    return Response.json({ success: false, outcome, error: code, message });
  };
  const unlock = async () => {
    if (gid) await db.Group.updateMany({ id: gid, cancellation_operation_id: audit.id }, { $unset: { cancellation_operation_id: '' } });
    await db.Quote.updateMany({ id: quoteId, cancellation_operation_id: audit.id }, { $unset: { cancellation_operation_id: '' } });
  };

  // Atomic locks (compare-and-set). Losers write nothing else.
  const ql = await db.Quote.updateMany({ id: quoteId, cancellation_operation_id: null }, { $set: { cancellation_operation_id: audit.id } });
  if (ql?.updated !== 1) return block('QUOTE_LOCK_NOT_ACQUIRED', 'CONCURRENT', MESSAGES.IN_PROGRESS);
  if (gid) {
    const gl = await db.Group.updateMany({ id: gid, cancellation_operation_id: null, status: preview.group.status }, { $set: { cancellation_operation_id: audit.id } });
    if (gl?.updated !== 1) { await unlock(); return block('GROUP_LOCK_NOT_ACQUIRED', 'CONCURRENT', MESSAGES.IN_PROGRESS); }
  }

  // Full revalidation under the lock: nothing may have changed since the caller's preview.
  const locked = await invokePreview(audit.id);
  const lockedRule = locked?.reasons?.[reason];
  if (!locked?.success || locked.fingerprint !== preview.fingerprint || !lockedRule?.eligible) {
    await unlock();
    return block(locked?.fingerprint !== preview.fingerprint ? 'STALE_UNDER_LOCK' : 'REVALIDATION_FAILED', 'STALE', MESSAGES.STALE);
  }
  await db.QuoteCancellationAudit.update(audit.id, { state: 'IN_PROGRESS' });
  return finish(base44, db, { ...audit, state: 'IN_PROGRESS' });
}