import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { assertQuotePreparationEnabled } from '../../shared/quotePreparationConfig.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    assertQuotePreparationEnabled();
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const internal = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const role = internal[0]?.role || user.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'QUOTES_MANAGER'].includes(role)) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });
    const { quote_id, rejection_reason } = await req.json();
    if (!quote_id || !String(rejection_reason || '').trim()) return Response.json({ success: false, error: 'REJECTION_REASON_REQUIRED' }, { status: 400 });
    const quote = await base44.asServiceRole.entities.Quote.get(quote_id);
    if (!quote?.preparation_flow_enabled) return Response.json({ success: false, error: 'NOT_PREPARATION_FLOW' }, { status: 409 });
    if (quote.status === 'APPROVED') return Response.json({ success: false, error: 'APPROVED_QUOTE_CANNOT_BE_REJECTED' }, { status: 409 });
    if (quote.status === 'REJECTED') return Response.json({ success: true, status: 'already_rejected', quote_id, group_id: quote.group_id });
    await base44.asServiceRole.entities.Quote.update(quote_id, { status: 'REJECTED', rejected_at: new Date().toISOString(), rejected_by: user.email, rejection_reason: String(rejection_reason).trim() });
    console.log('[quotePreparationFlow]', JSON.stringify({ action: 'reject', quote_id, group_id: quote.group_id, before_status: quote.status, after_status: 'REJECTED', user: user.email, timestamp: new Date().toISOString() }));
    return Response.json({ success: true, status: 'rejected', quote_id, group_id: quote.group_id, data_deleted: false });
  } catch (error) {
    console.error('[rejectQuotePreparation]', error?.message);
    return Response.json({ success: false, error: error?.code || 'INTERNAL_ERROR' }, { status: error?.code ? 409 : 500 });
  }
});