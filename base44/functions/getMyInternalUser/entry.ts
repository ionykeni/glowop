import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Resolves the signed-in user's InternalUser row (role used by the UI).
// Security: there is NO testing-agent bypass. The former `is_test_agent_user` → ADMIN shortcut was removed
// because that flag lives on the User record (users can edit their own custom fields) and must never grant a role.
// Testing Agent accounts need an explicit InternalUser row with the role under test.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const normalizedEmail = user.email.trim().toLowerCase();

    // Use service role to bypass row-level security
    const escaped = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidates = await base44.asServiceRole.entities.InternalUser.filter(
      { email: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } }, '-updated_date', 10
    );
    const rows = Array.isArray(candidates) ? candidates : (candidates?.items || []);
    const match = rows.find(u => u.active !== false) || rows[0];

    if (!match) {
      console.log('[ACCESS DENIED] email not in InternalUser whitelist:', normalizedEmail);
      return Response.json({ found: false, email: normalizedEmail });
    }

    return Response.json({ found: true, email: match.email, role: match.role, active: match.active, name: match.name });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});