import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const normalizedEmail = user.email.trim().toLowerCase();

    // Base44 Testing Agent — its temporary test user is not in the InternalUser
    // whitelist. Grant it ADMIN access automatically so automated tests can run.
    if (user.is_test_agent_user === true) {
      console.log('[TEST AGENT] granting ADMIN access to test user:', normalizedEmail);
      return Response.json({ found: true, email: normalizedEmail, role: 'ADMIN', active: true, name: 'Testing Agent' });
    }

    // Use service role to bypass row-level security
    const escaped = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidates = await base44.asServiceRole.entities.InternalUser.filter(
      { email: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } }, '-updated_date', 10
    );
    const rows = Array.isArray(candidates) ? candidates : (candidates?.items || []);
    const match = rows.find(u => u.active !== false) || rows[0];

    if (!match) {
      // Fallback test-agent detection (in case the flag is not present on auth.me())
      try {
        const authUsers = await base44.asServiceRole.entities.User.filter({ email: user.email });
        if (authUsers.some(u => u.is_test_agent_user === true)) {
          console.log('[TEST AGENT] granting ADMIN access to test user:', normalizedEmail);
          return Response.json({ found: true, email: normalizedEmail, role: 'ADMIN', active: true, name: 'Testing Agent' });
        }
      } catch (e) {
        console.log('[TEST AGENT] fallback check failed:', e.message);
      }
      console.log('[ACCESS DENIED] email not in InternalUser whitelist:', normalizedEmail);
      return Response.json({ found: false, email: normalizedEmail });
    }

    return Response.json({ found: true, email: match.email, role: match.role, active: match.active, name: match.name });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});