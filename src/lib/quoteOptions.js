export const QUOTE_OPTION_FIELDS = [
  "package_lines", "new_addon_lines", "student_lodging_lines", "adult_lodging_lines",
  "workshop_lines", "lecture_lines", "coffee_corner_pax", "includes_prisa", "addon_lines",
  "adjustment_lines", "surcharge_lines", "discount_percent", "subtotal", "discount_amount",
  "total_price", "advance_payment", "balance_payment", "payment_terms", "option_notes", "vip_people",
];

export function extractQuoteOptionPayload(quote = {}) {
  return Object.fromEntries(QUOTE_OPTION_FIELDS.map(field => [field, quote[field]]));
}

export function applyOptionPayloadToQuote(quote, payload = {}) {
  const next = { ...quote };
  QUOTE_OPTION_FIELDS.forEach(field => { if (field in payload) next[field] = payload[field]; });
  return next;
}

export function getEffectiveQuoteForOption(quote, option) {
  if (!option) return quote;
  const payload = typeof option.option_payload === "string" ? JSON.parse(option.option_payload || "{}") : option.option_payload;
  return applyOptionPayloadToQuote(quote, payload);
}

export function createEmptyQuoteOption() {
  return {
    package_lines: "[]", new_addon_lines: "[]", student_lodging_lines: "[]", adult_lodging_lines: "[]",
    workshop_lines: "[]", lecture_lines: "[]", coffee_corner_pax: 0, includes_prisa: false,
    addon_lines: "[]", adjustment_lines: "[]", surcharge_lines: "[]", discount_percent: 0,
    subtotal: 0, discount_amount: 0, total_price: 0, advance_payment: 0, balance_payment: 0,
    payment_terms: "", option_notes: "", vip_people: 0,
  };
}

const DERIVED_OPTION_FIELDS = new Set(["subtotal", "discount_amount", "total_price", "advance_payment", "balance_payment"]);
const JSON_OPTION_FIELDS = new Set(QUOTE_OPTION_FIELDS.filter(field => field.endsWith("_lines")));
const NUMERIC_OPTION_FIELDS = new Set(["coffee_corner_pax", "discount_percent", "vip_people"]);
const BOOLEAN_OPTION_FIELDS = new Set(["includes_prisa"]);
const comparableValue = (field, value) => {
  if (JSON_OPTION_FIELDS.has(field)) {
    try { return JSON.stringify(JSON.parse(value || "[]")); } catch { return value || "[]"; }
  }
  if (NUMERIC_OPTION_FIELDS.has(field)) return Number(value || 0);
  if (BOOLEAN_OPTION_FIELDS.has(field)) return value === true;
  return value || "";
};

export function isOptionDraftSemanticallyEqual(left = {}, right = {}) {
  return QUOTE_OPTION_FIELDS
    .filter(field => !DERIVED_OPTION_FIELDS.has(field))
    .every(field => comparableValue(field, left[field]) === comparableValue(field, right[field]));
}