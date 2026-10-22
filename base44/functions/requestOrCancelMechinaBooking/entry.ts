import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "OPERATIONS"];
const ADMIN_EMAILS = ["hospitality@glow-glamping.com", "shelly.fleischman@gmail.com", "vered@keren-hador.com"];

Deno.serve(async (req) => {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: "לא מחובר" }, { status: 401 });

    const { request_id, reason } = await req.json();
    if (!request_id) return Response.json({ success: false, error: "חסר מזהה בקשה" });

    // Load InternalUser
    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const internalUser = internalUsers[0];
    const role = internalUser?.role || "";
    const isAdmin = ADMIN_ROLES.includes(role);
    const isMechina = role === "MECHINA_USER";

    if (!isAdmin && !isMechina) {
      return Response.json({ success: false, error: "אין הרשאה" }, { status: 403 });
    }

    // Load request
    let request;
    try {
      request = await base44.asServiceRole.entities.CommonSpaceBookingRequest.get(request_id);
    } catch {
      return Response.json({ success: false, error: "בקשה לא נמצאה" });
    }
    if (!request) return Response.json({ success: false, error: "בקשה לא נמצאה" });

    const now = new Date().toISOString();

    // ── MECHINA USER ────────────────────────────────────────────────────────
    if (isMechina) {
      // Verify assignment
      const assignments = await base44.asServiceRole.entities.MechinaGroupAssignment.filter({
        user_email: user.email,
        group_id: request.mechina_group_id,
        is_active: true,
      });
      if (assignments.length === 0) {
        return Response.json({ success: false, error: "אין הרשאה לביטול בקשה זו" }, { status: 403 });
      }

      // Case 3 — already terminal
      if (["REJECTED", "CANCELLED", "CANCELLATION_REQUESTED"].includes(request.status)) {
        return Response.json({ success: false, error: "לא ניתן לבטל בקשה זו" });
      }

      // Case 1 — PENDING or CHANGE_REQUESTED: cancel directly
      if (["PENDING", "CHANGE_REQUESTED"].includes(request.status)) {
        const updateData = { status: "CANCELLED" };
        if (reason) updateData.admin_notes = reason;

        await base44.asServiceRole.entities.CommonSpaceBookingRequest.update(request_id, updateData);

        // Notify admins
        const emailBody = buildEmail("בקשה בוטלה על ידי מכינה", request, reason, null);
        for (const adminEmail of ADMIN_EMAILS) {
          try {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: adminEmail,
              subject: "בקשה בוטלה על ידי מכינה",
              body: emailBody,
            });
          } catch (e) { console.warn("Email failed:", e.message); }
        }

        return Response.json({ success: true, action: "CANCELLED" });
      }

      // Case 2 — APPROVED: submit cancellation request
      if (request.status === "APPROVED") {
        const updateData = { status: "CANCELLATION_REQUESTED" };
        if (reason) updateData.admin_notes = reason;

        await base44.asServiceRole.entities.CommonSpaceBookingRequest.update(request_id, updateData);

        // Notify admins
        const emailBody = buildEmail("בקשת ביטול להזמנת מרחב — מכינה", request, reason, null);
        for (const adminEmail of ADMIN_EMAILS) {
          try {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: adminEmail,
              subject: "בקשת ביטול להזמנת מרחב — מכינה",
              body: emailBody,
            });
          } catch (e) { console.warn("Email failed:", e.message); }
        }

        return Response.json({ success: true, action: "CANCELLATION_REQUESTED" });
      }

      return Response.json({ success: false, error: "לא ניתן לבטל בקשה בסטטוס זה" });
    }

    // ── ADMIN ───────────────────────────────────────────────────────────────
    if (!["PENDING", "CHANGE_REQUESTED", "APPROVED", "CANCELLATION_REQUESTED"].includes(request.status)) {
      return Response.json({ success: false, error: "לא ניתן לבטל בקשה בסטטוס זה" });
    }

    let cancelledScheduleItemId = null;

    // Cancel linked GroupScheduleItem if APPROVED or CANCELLATION_REQUESTED
    if (["APPROVED", "CANCELLATION_REQUESTED"].includes(request.status) && request.approved_schedule_item_id) {
      try {
        const scheduleItem = await base44.asServiceRole.entities.GroupScheduleItem.get(request.approved_schedule_item_id);
        if (scheduleItem) {
          const existingNotes = scheduleItem.notes ? scheduleItem.notes + "\n" : "";
          await base44.asServiceRole.entities.GroupScheduleItem.update(request.approved_schedule_item_id, {
            status: "CANCELLED",
            notes: existingNotes + "בוטל דרך בקשת מרחב מכינה",
          });
          cancelledScheduleItemId = request.approved_schedule_item_id;
        }
      } catch (e) {
        console.error("Failed to cancel GroupScheduleItem:", e.message);
      }
    }

    const updateData = {
      status: "CANCELLED",
      admin_decision_at: now,
      admin_decision_by_user_id: user.id,
      admin_decision_by_name: user.full_name || user.email,
    };
    if (reason) updateData.admin_notes = reason;

    await base44.asServiceRole.entities.CommonSpaceBookingRequest.update(request_id, updateData);

    // Notify requester
    const emailBody = buildEmail("ההזמנה למרחב בוטלה", request, reason, true);
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: request.requested_by_email,
        subject: "ההזמנה למרחב בוטלה",
        body: emailBody,
      });
    } catch (e) { console.warn("Email failed:", e.message); }

    return Response.json({ success: true, action: "CANCELLED", cancelled_schedule_item_id: cancelledScheduleItemId });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

function buildEmail(title, request, reason, byAdmin) {
  return `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #dc2626;">${title}</h2>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px; font-weight: bold; width: 40%;">מרחב:</td><td style="padding: 8px;">${request.space_name || ""}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding: 8px; font-weight: bold;">תאריך:</td><td style="padding: 8px;">${request.date || ""}</td></tr>
    <tr><td style="padding: 8px; font-weight: bold;">שעות:</td><td style="padding: 8px;">${request.start_time || ""}–${request.end_time || ""}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding: 8px; font-weight: bold;">פעילות:</td><td style="padding: 8px;">${request.activity_title || ""}</td></tr>
    <tr><td style="padding: 8px; font-weight: bold;">שולח הבקשה:</td><td style="padding: 8px;">${request.requested_by_name || request.requested_by_email || ""}</td></tr>
    ${reason ? `<tr style="background:#f9fafb;"><td style="padding: 8px; font-weight: bold;">סיבה:</td><td style="padding: 8px;">${reason}</td></tr>` : ""}
  </table>
  ${byAdmin ? `<p style="color: #6b7280; font-size: 13px;">הבקשה בוטלה על ידי הנהלה.</p>` : ""}
  <p style="color: #6b7280; font-size: 13px;">לשאלות ניתן לפנות לצוות הניהול.</p>
</div>`;
}