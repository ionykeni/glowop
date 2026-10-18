import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SUPER_ADMIN_ROLES = new Set(['SUPER_ADMIN']);

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) {
      return Response.json({ success: false, error: 'נדרשת התחברות' }, { status: 401 });
    }

    // Resolve effective role from InternalUser
    let effectiveRole = user.role;
    try {
      const rows = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
      const internal = rows[0];
      if (internal?.role) effectiveRole = internal.role;
    } catch {}

    if (!SUPER_ADMIN_ROLES.has(effectiveRole)) {
      return Response.json({ success: false, error: 'מחיקת נהלים מותרת ל-SUPER_ADMIN בלבד' }, { status: 403 });
    }

    const body = await req.json();
    const { id } = body;
    if (!id) {
      return Response.json({ success: false, error: 'חסר מזהה נוהל' }, { status: 400 });
    }

    await base44.asServiceRole.entities.OperationalProcedure.delete(id);
    return Response.json({ success: true });
  } catch (err) {
    console.error('[deleteOperationalProcedure] error:', err?.message);
    return Response.json({ success: false, error: 'שגיאה פנימית במחיקת נוהל' }, { status: 500 });
  }
}