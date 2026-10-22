import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// B2 guarded commit. Revalidates everything through the read-only preview (same caller token),
// never accepts a caller-supplied group_id, and requires an explicit no-arrival declaration when the
// planned arrival is today or earlier. Writes are disabled until the B2 release gate is proven.
const REASONS = new Set(['CUSTOMER_CANCELLED', 'CREATED_BY_MISTAKE']);

const MESSAGES = {
  ACTUAL_STAY_EVIDENCE: 'קיימים רישומים תפעוליים שמעידים על שהייה בפועל. נדרשת בדיקה תפעולית.',
  NO_ARRIVAL_DECLARATION_REQUIRED: 'יש לאשר שהקבוצה לא הגיעה.',
  STALE: 'הנתונים השתנו מאז הפתיחה. יש לפתוח מחדש.',
  DISABLED: 'הפעולה עדיין אינה זמינה.',
  BLOCKED: 'לא ניתן לבצע כרגע. נדרשת בדיקה תפעולית.',
};

export default async function(req) {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const quoteId = typeof body.quote_id === 'string' ? body.quote_id.trim() : '';
  const reason = body.reason;
  if (!quoteId || !REASONS.has(reason)) return Response.json({ success: false, error: 'INVALID_REQUEST' }, { status: 400 });

  // Authorization (QUOTES_MANAGER / SUPER_ADMIN) and all checks happen inside the preview.
  const preview = await base44.functions.invoke('previewQuoteBookingCancellation', { quote_id: quoteId })
    .then(r => r.data, e => e?.response?.data || null);
  if (!preview?.success) return Response.json({ success: false, error: preview?.error || 'PREVIEW_FAILED' }, { status: 403 });

  if (body.fingerprint !== preview.fingerprint) return Response.json({ success: false, outcome: 'STALE', message: MESSAGES.STALE });
  if (preview.requires_no_arrival_declaration && body.no_arrival_declared !== true) {
    return Response.json({ success: false, outcome: 'BLOCKED', error: 'NO_ARRIVAL_DECLARATION_REQUIRED', message: MESSAGES.NO_ARRIVAL_DECLARATION_REQUIRED });
  }
  // Mistaken withdrawal touches only the Quote; operational blockers that require modifying Group data still block.
  const blockers = preview.blockers || [];
  if (blockers.includes('ACTUAL_STAY_EVIDENCE')) return Response.json({ success: false, outcome: 'BLOCKED', message: MESSAGES.ACTUAL_STAY_EVIDENCE });
  if (blockers.length) return Response.json({ success: false, outcome: 'BLOCKED', message: MESSAGES.BLOCKED });

  // Release gate: no writes (including audit) until serialization, recovery and idempotency are proven.
  if (!preview.commit_enabled) return Response.json({ success: false, outcome: 'DISABLED', message: MESSAGES.DISABLED, validated: true });

  return Response.json({ success: false, outcome: 'DISABLED', message: MESSAGES.DISABLED });
}