export const QUOTE_PREPARATION_FLOW = true;
export const QUOTE_PREPARATION_ROLLOUT = "ADMINS";

export function isQuotePreparationEnabled(role) {
  if (!QUOTE_PREPARATION_FLOW) return false;
  return QUOTE_PREPARATION_ROLLOUT === "SUPER_ADMIN_ONLY" ? role === "SUPER_ADMIN" : ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"].includes(role);
}

export const isQuoteOpen = (quote) => ["DRAFT", "SENT"].includes(String(quote?.status || "").toUpperCase());
export const isQuoteApproved = (quote) => String(quote?.status || "").toUpperCase() === "APPROVED";
export const isQuoteRejected = (quote) => ["REJECTED", "EXPIRED"].includes(String(quote?.status || "").toUpperCase());
export const isOperationalGroup = (group) => !(group?.quote_preparation_flow && group.status !== "CONFIRMED");