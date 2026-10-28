export const QUOTE_PREPARATION_FLOW = true;
export const QUOTE_PREPARATION_ROLLOUT = "ADMINS";
// B2 booking cancellation entry point stays hidden until its release (backend commit gate is also off).
export const QUOTE_B2_CANCELLATION_UI_ENABLED = true;

export function isQuotePreparationEnabled(role) {
  if (!QUOTE_PREPARATION_FLOW) return false;
  return QUOTE_PREPARATION_ROLLOUT === "SUPER_ADMIN_ONLY" ? role === "SUPER_ADMIN" : ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"].includes(role);
}

export const isQuoteOpen = (quote) => ["DRAFT", "SENT"].includes(String(quote?.status || "").toUpperCase());
export const isQuoteApproved = (quote) => String(quote?.status || "").toUpperCase() === "APPROVED";
export const isQuoteRejected = (quote) => ["REJECTED", "EXPIRED"].includes(String(quote?.status || "").toUpperCase());
// A booking is cancelled only when the linked Group is loaded and explicitly CANCELLED.
// Quote.status stays APPROVED (commercial truth); missing Groups are never treated as cancelled.
export const isQuoteWithdrawnByMistake = quote => quote?.withdrawn_reason === "CREATED_BY_MISTAKE";
export const isQuoteCancelledBooking = (quote, group) => isQuoteWithdrawnByMistake(quote) || Boolean(quote?.group_id && group && group.id === quote.group_id && group.status === "CANCELLED");
export const isOperationalGroup = (group) => !(group?.quote_preparation_flow && group.status !== "CONFIRMED");