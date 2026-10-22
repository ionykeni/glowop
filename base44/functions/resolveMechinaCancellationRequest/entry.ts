import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "OPERATIONS"];

Deno.serve(async (req) => {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: "לא מחובר" }, { status: 401 });

    const { request_id, decision, admin_notes } = await req.json();
    if (!request_id) return Response.json({ success: false, error: "חסר מזהה בקשה" });
    if (!["APPROVE_CANCELLATION", "REJECT_CANCELLATION"].includes(decision)) {
      return Response.json({ success: false, error: "החלטה לא תקינה" });
    }

    // Auth check
    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const role = internalUsers[0]?.role || "";
    if (!ADMIN_ROLES.includes(role)) {
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

    if (request.status !== "CANCELLATION_REQUESTED") {
      return Response.json({ success: false, error: "הבקשה אינה בסטטוס בקשת ביטול" });
    }

    const now = new Date().toISOString();
    const adminMeta = {
      admin_decision_by_user_id: user.id,
      admin_decision_by_name: user.full_name || user.email,
      admin_decision_at: now,
    };
    if (admin_notes) adminMeta.admin_notes = admin_notes;

    if (decision === "APPROVE_CANCELLATION") {
      // Cancel linked GroupScheduleItem
      if (request.approved_schedule_item_id) {
        try {
          const scheduleItem = await base44.asServiceRole.entities.GroupScheduleItem.get(request.approved_schedule_item_id);
          if (scheduleItem) {
            const existingNotes = scheduleItem.notes ? scheduleItem.notes + "\n" : "";
            await base44.asServiceRole.entities.GroupScheduleItem.update(request.approved_schedule_item_id, {
              status: "CANCELLED",
              notes: existingNotes + "בוטל דרך בקשת ביטול מכינה — אושר על ידי מנהל",
            });
          }
        } catch (e) {
          console.error("Failed to cancel GroupScheduleItem:", e.message);
        }
      }

      await base44.asServiceRole.entities.CommonSpaceBookingRequest.update(request_id, {
        status: "CANCELLED",
        ...adminMeta,
      });

      // Email requester
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: request.requested_by_email,
          subject: "בקשת הביטול אושרה",
          body: buildEmail("בקשת הביטול אושרה — ההזמנה בוטלה", request, admin_notes, "approved"),
        });
      } catch (e) { console.warn("Email failed:", e.message); }

      return Response.json({ success: true, action: "CANCELLED" });
    }

    // REJECT_CANCELLATION — restore to APPROVED, leave GroupScheduleItem ACTIVE
    await base44.asServiceRole.entities.CommonSpaceBookingRequest.update(request_id, {
      status: "APPROVED",
      ...adminMeta,
    });

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: request.requested_by_email,
        subject: "בקשת הביטול נדחתה",
        body: buildEmail("בקשת הביטול נדחתה — ההזמנה נשארת פעילה", request, admin_notes, "rejected"),
      });
    } catch (e) { console.warn("Email failed:", e.message); }

    return Response.json({ success: true, action: "APPROVED" });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

function buildEmail(title, request, adminNotes, outcome) {
  const outcomeText = outcome === "approved"
    ? "בקשת הביטול שלך אושרה — ההזמנה בוטלה."
    : "בקשת הביטול שלך נדחתה — ההזמנה נשארת פעילה.";

  return `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: ${outcome === "approved" ? "#dc2626" : "#2563eb"};">${title}</h2>
  <p>${outcomeText}</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px; font-weight: bold; width: 40%;">מרחב:</td><td style="padding: 8px;">${request.space_name || ""}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding: 8px; font-weight: bold;">תאריך:</td><td style="padding: 8px;">${request.date || ""}</td></tr>
    <tr><td style="padding: 8px; font-weight: bold;">שעות:</td><td style="padding: 8px;">${request.start_time || ""}–${request.end_time || ""}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding: 8px; font-weight: bold;">פעילות:</td><td style="padding: 8px;">${request.activity_title || ""}</td></tr>
    ${adminNotes ? `<tr><td style="padding: 8px; font-weight: bold;">הערת מנהל:</td><td style="padding: 8px;">${adminNotes}</td></tr>` : ""}
  </table>
  <p style="color: #6b7280; font-size: 13px;">לשאלות ניתן לפנות לצוות הניהול.</p>
</div>`;
}