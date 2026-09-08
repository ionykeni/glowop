import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { assertQuoteMultiOptionEnabled, extractQuoteOptionPayload, applyOptionPayloadToQuote, getQuoteOption, getExactQuoteOptions, createEmptyQuoteOption } from '../../shared/quoteOptions.js';

const optionRecord = (quoteId, key, payload, user, sourceId) => ({
  quote_id: quoteId, option_key: key, label: key === 'A' ? 'אפשרות א׳' : 'אפשרות ב׳', display_order: key === 'A' ? 1 : 2,
  option_payload: JSON.stringify(payload), subtotal: Number(payload.subtotal || 0), discount_amount: Number(payload.discount_amount || 0),
  total_price: Number(payload.total_price || 0), advance_payment: Number(payload.advance_payment || 0), balance_payment: Number(payload.balance_payment || 0),
  status: 'AVAILABLE', ...(sourceId ? { created_from_option_id: sourceId } : {}), created_by: user.email, updated_by: user.email,
});

Deno.serve(async req => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const internal = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const role = internal[0]?.role || user.role;
    assertQuoteMultiOptionEnabled(role);
    if (!['SUPER_ADMIN', 'ADMIN', 'QUOTES_MANAGER'].includes(role)) return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });

    const body = await req.json();
    const { action, quote_id } = body;
    if (!quote_id) return Response.json({ success: false, error: 'MISSING_QUOTE_ID' }, { status: 400 });
    const quote = await base44.asServiceRole.entities.Quote.get(quote_id);
    if (!quote) return Response.json({ success: false, error: 'QUOTE_NOT_FOUND' }, { status: 404 });

    if (action === 'materialize') {
      let optionA = await getQuoteOption(base44, quote_id, 'A');
      let optionB = await getQuoteOption(base44, quote_id, 'B');
      if (!optionA) optionA = await base44.asServiceRole.entities.QuoteOption.create(optionRecord(quote_id, 'A', body.option_a_payload || extractQuoteOptionPayload(quote), user));
      optionB = await getQuoteOption(base44, quote_id, 'B');
      if (!optionB) optionB = await base44.asServiceRole.entities.QuoteOption.create(optionRecord(quote_id, 'B', createEmptyQuoteOption('B'), user));
      const exact = await getExactQuoteOptions(base44, quote_id);
      await base44.asServiceRole.entities.Quote.update(quote_id, { multi_option_enabled: true });
      return Response.json({ success: true, options: [exact.A, exact.B], quote_id, group_id: quote.group_id });
    }

    if (action === 'save') {
      if (!body.options?.A || !body.options?.B) return Response.json({ success: false, error: 'BOTH_OPTIONS_REQUIRED' }, { status: 400 });
      const saved = [];
      for (const key of ['A', 'B']) {
        const existing = await getQuoteOption(base44, quote_id, key);
        const data = optionRecord(quote_id, key, body.options[key], user, existing?.created_from_option_id);
        saved.push(existing ? await base44.asServiceRole.entities.QuoteOption.update(existing.id, { ...data, status: existing.status, created_by: existing.created_by }) : await base44.asServiceRole.entities.QuoteOption.create(data));
      }
      const exact = await getExactQuoteOptions(base44, quote_id);
      const legacyOptionA = applyOptionPayloadToQuote({}, body.options.A); delete legacyOptionA.option_notes;
      await base44.asServiceRole.entities.Quote.update(quote_id, { ...legacyOptionA, multi_option_enabled: true });
      return Response.json({ success: true, options: [exact.A, exact.B], quote_id, group_id: quote.group_id });
    }

    if (action === 'delete_b') {
      const optionB = await getQuoteOption(base44, quote_id, 'B');
      if (!optionB) return Response.json({ success: true, status: 'already_deleted' });
      if (optionB.status === 'SELECTED' || quote.approved_option_key === 'B') return Response.json({ success: false, error: 'APPROVED_OPTION_CANNOT_BE_DELETED' }, { status: 409 });
      await base44.asServiceRole.entities.QuoteOption.delete(optionB.id);
      await base44.asServiceRole.entities.Quote.update(quote_id, { multi_option_enabled: false });
      if (quote.status !== 'APPROVED') await base44.asServiceRole.entities.Quote.updateMany({ id: quote_id }, { $unset: { approved_option_key: '', approved_option_total_price: '', approved_option_snapshot: '' } });
      return Response.json({ success: true, quote_id, group_id: quote.group_id });
    }

    return Response.json({ success: false, error: 'INVALID_ACTION' }, { status: 400 });
  } catch (error) {
    const status = error?.code === 'FEATURE_NOT_ENABLED_FOR_ROLE' ? 403 : ['DUPLICATE_QUOTE_OPTION', 'BOTH_OPTIONS_REQUIRED'].includes(error?.code) ? 409 : 500;
    return Response.json({ success: false, error: error?.code || error.message }, { status });
  }
});