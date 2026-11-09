// Discount types for a quote: percentage of the subtotal, or a fixed NIS amount.
// The amount is always clamped to [0, subtotal] so totals can never go negative.
export const DISCOUNT_TYPE = { PERCENT: "PERCENT", FIXED: "FIXED" };

export function normalizeDiscountType(value) {
  return value === DISCOUNT_TYPE.FIXED ? DISCOUNT_TYPE.FIXED : DISCOUNT_TYPE.PERCENT;
}

export function resolveQuoteDiscount(source = {}, subtotal = 0) {
  const base = Math.max(0, Number(subtotal) || 0);
  const type = normalizeDiscountType(source.discount_type);
  const percent = Number(source.discount_percent || 0);
  const raw = type === DISCOUNT_TYPE.FIXED ? Number(source.discount_amount || 0) : base * percent / 100;
  const rounded = Math.round(Number.isFinite(raw) ? raw : 0);
  const amount = Math.min(base, Math.max(0, rounded));
  return { type, percent: type === DISCOUNT_TYPE.PERCENT ? percent : 0, amount, total: base - amount };
}