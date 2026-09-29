// ── Private Logistics AI Assistant — Access Configuration ──────────────────
// Single source of truth for who can see the logistics assistant tab and route.
// Gate is by EXACT email match (not role) — only the logistics manager.
// The backend context function enforces the same email server-side.
export const LOGISTICS_MANAGER_EMAIL = "hospitality@glow-glamping.com";

export const LOGISTICS_AGENT_NAME = "logistics_assistant";

// Check whether the currently authenticated user is the authorized logistics manager.
export function isLogisticsManager(userEmail) {
  const allowed = LOGISTICS_MANAGER_EMAIL.trim().toLowerCase();
  if (!allowed) return false;
  return String(userEmail || "").trim().toLowerCase() === allowed;
}