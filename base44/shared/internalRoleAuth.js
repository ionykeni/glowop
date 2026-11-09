// Resolves the caller's InternalUser role (active rows only, normalized email). No platform-role fallback.
const norm = (e) => String(e || '').trim().toLowerCase();

export async function resolveInternalRole(base44, user) {
  const rows = await base44.asServiceRole.entities.InternalUser.filter({ active: true });
  const row = rows.find(r => norm(r.email) === norm(user.email));
  return row?.role || null;
}