export const QUOTE_MULTI_OPTION_FLOW = true;
export const QUOTE_MULTI_OPTION_ROLLOUT = 'QUOTE_AUTHORITIES';

export const QUOTE_OPTION_FIELDS = [
  'package_lines', 'new_addon_lines', 'student_lodging_lines', 'adult_lodging_lines',
  'workshop_lines', 'lecture_lines', 'coffee_corner_pax', 'includes_prisa', 'addon_lines',
  'adjustment_lines', 'surcharge_lines', 'discount_percent', 'subtotal', 'discount_amount',
  'total_price', 'advance_payment', 'balance_payment', 'payment_terms', 'option_notes',
];

export const SHARED_QUOTE_FIELDS = [
  'group_id', 'group_name', 'quote_number', 'version', 'quote_type', 'quote_audience_type',
  'client_name', 'contact_person', 'client_phone', 'client_email', 'client_tax_id',
  'arrival_date', 'departure_date', 'arrival_time', 'departure_time', 'nights',
  'estimated_pax', 'staff_count', 'participant_count', 'client_notes', 'valid_until', 'internal_notes',
];

export function extractSharedQuoteFields(quote = {}) {
  return Object.fromEntries(SHARED_QUOTE_FIELDS.filter(field => quote[field] !== undefined).map(field => [field, quote[field]]));
}

export const assertQuoteMultiOptionEnabled = role => {
  const allowed = QUOTE_MULTI_OPTION_FLOW && (QUOTE_MULTI_OPTION_ROLLOUT === 'SUPER_ADMIN_ONLY' ? role === 'SUPER_ADMIN' : ['SUPER_ADMIN', 'ADMIN', 'QUOTES_MANAGER'].includes(role));
  if (!allowed) throw Object.assign(new Error('FEATURE_NOT_ENABLED_FOR_ROLE'), { code: 'FEATURE_NOT_ENABLED_FOR_ROLE' });
};

export function extractQuoteOptionPayload(quote = {}) {
  return Object.fromEntries(QUOTE_OPTION_FIELDS.map(field => [field, quote[field]]));
}

export function applyOptionPayloadToQuote(quote, payload = {}) {
  const next = { ...quote };
  QUOTE_OPTION_FIELDS.forEach(field => { if (field in payload) next[field] = payload[field]; });
  return next;
}

export async function getQuoteOption(base44, quoteId, optionKey) {
  const rows = await base44.asServiceRole.entities.QuoteOption.filter({ quote_id: quoteId, option_key: optionKey });
  if (rows.length > 1) throw Object.assign(new Error('DUPLICATE_QUOTE_OPTION'), { code: 'DUPLICATE_QUOTE_OPTION' });
  return rows[0] || null;
}

export async function getEffectiveQuoteForOption(base44, quote, optionKey) {
  const option = await getQuoteOption(base44, quote.id, optionKey);
  if (!option) throw Object.assign(new Error('QUOTE_OPTION_NOT_FOUND'), { code: 'QUOTE_OPTION_NOT_FOUND' });
  return applyOptionPayloadToQuote(quote, JSON.parse(option.option_payload || '{}'));
}

export function createEmptyQuoteOption(optionKey = 'B') {
  const emptyArrays = new Set([
    'package_lines', 'new_addon_lines', 'student_lodging_lines', 'adult_lodging_lines',
    'workshop_lines', 'lecture_lines', 'addon_lines', 'adjustment_lines', 'surcharge_lines',
  ]);
  return Object.fromEntries(QUOTE_OPTION_FIELDS.map(field => {
    if (emptyArrays.has(field)) return [field, JSON.stringify([])];
    if (field === 'includes_prisa') return [field, false];
    if (field === 'payment_terms' || field === 'option_notes') return [field, ''];
    return [field, 0];
  }));
}

export async function getExactQuoteOptions(base44, quoteId) {
  const rows = await base44.asServiceRole.entities.QuoteOption.filter({ quote_id: quoteId });
  const optionA = rows.filter(row => row.option_key === 'A');
  const optionB = rows.filter(row => row.option_key === 'B');
  if (optionA.length !== 1 || optionB.length !== 1 || rows.length !== 2) throw Object.assign(new Error(optionA.length > 1 || optionB.length > 1 ? 'DUPLICATE_QUOTE_OPTION' : 'BOTH_OPTIONS_REQUIRED'), { code: optionA.length > 1 || optionB.length > 1 ? 'DUPLICATE_QUOTE_OPTION' : 'BOTH_OPTIONS_REQUIRED' });
  return { A: optionA[0], B: optionB[0] };
}

export async function resolveSelectedQuoteOption(base44, quote, selectedKey) {
  const key = quote.multi_option_enabled ? selectedKey : 'A';
  if (quote.multi_option_enabled && !['A', 'B'].includes(key)) throw Object.assign(new Error('SELECTED_OPTION_REQUIRED'), { code: 'SELECTED_OPTION_REQUIRED' });
  if (quote.status === 'APPROVED' && quote.approved_option_key && quote.approved_option_key !== key) throw Object.assign(new Error('QUOTE_ALREADY_APPROVED_WITH_DIFFERENT_OPTION'), { code: 'QUOTE_ALREADY_APPROVED_WITH_DIFFERENT_OPTION' });
  if (!quote.multi_option_enabled) return { key: 'A', option: null, payload: extractQuoteOptionPayload(quote), effectiveQuote: quote };
  const options = await getExactQuoteOptions(base44, quote.id);
  const option = options[key];
  const payload = JSON.parse(option.option_payload || '{}');
  return { key, option, payload, effectiveQuote: applyOptionPayloadToQuote(quote, payload) };
}

export function buildApprovedOptionSnapshot(quote, selection, user, ids) {
  return JSON.stringify({ captured_at: new Date().toISOString(), approved_by: user.email, quote_id: quote.id, group_id: ids.groupId, operational_profile_id: ids.profileId, selected_option_key: selection.key, label: selection.option?.label || 'אפשרות א׳', total_price: Number(selection.effectiveQuote.total_price || 0), shared: { client_name: quote.client_name, group_name: quote.group_name, contact_person: quote.contact_person, client_phone: quote.client_phone, client_email: quote.client_email, arrival_date: quote.arrival_date, departure_date: quote.departure_date, estimated_pax: quote.estimated_pax, staff_count: quote.staff_count, participant_count: quote.participant_count, quote_audience_type: quote.quote_audience_type, quote_type: quote.quote_type, client_notes: quote.client_notes }, option_payload: selection.payload });
}

export async function markSelectedQuoteOption(base44, quoteId, selectedKey) {
  if (!['A', 'B'].includes(selectedKey)) throw Object.assign(new Error('SELECTED_OPTION_REQUIRED'), { code: 'SELECTED_OPTION_REQUIRED' });
  const options = await getExactQuoteOptions(base44, quoteId);
  await base44.asServiceRole.entities.QuoteOption.update(options.A.id, { status: selectedKey === 'A' ? 'SELECTED' : 'NOT_SELECTED' });
  await base44.asServiceRole.entities.QuoteOption.update(options.B.id, { status: selectedKey === 'B' ? 'SELECTED' : 'NOT_SELECTED' });
}