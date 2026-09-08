export const QUOTE_MULTI_OPTION_FLOW = true;
export const QUOTE_MULTI_OPTION_ROLLOUT = "ADMINS";

export function isQuoteMultiOptionEnabled(role) {
  if (!QUOTE_MULTI_OPTION_FLOW) return false;
  return QUOTE_MULTI_OPTION_ROLLOUT === "SUPER_ADMIN_ONLY"
    ? role === "SUPER_ADMIN"
    : ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"].includes(role);
}