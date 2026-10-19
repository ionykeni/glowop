import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { isMechinaRequestsEnabled, MECHINA_DISABLED_REASON, rejectPendingMechinaRequests } from '../../shared/mechinaSpaceEligibility.js';

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "OPERATIONS"];

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function timesOverlap(s1, e1, s2, e2) {
  return timeToMinutes(s1) < timeToMinutes(e2) && timeToMinutes(s2) < timeToMinutes(e1);
}

function reservationOverlapsBlock(block, date, startTime, endTime) {
  const reservationStart = `${date}T${startTime}`;
  const reservationEnd = `${date}T${endTime}`;
  const blockStart = `${block.start_date}T${block.start_time}`;
  if (block.is_open_ended) return reservationEnd > blockStart;
  return reservationStart < `${block.end_date}T${block.end_time}` && blockStart < reservationEnd;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // A. Auth / permission
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ success: false, error: "לא מחובר" }, { status: 401 });

    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const internalUser = internalUsers[0];
    if (!internalUser || !ADMIN_ROLES.includes(internalUser.role)) {
      return Response.json({ success: false, error: "אין הרשאה לאשר בקשות" }, { status: 403 });
    }

    const body = await req.json();
    const { request_id, admin_notes } = body;
    if (!request_id) return Response.json({ success: false, error: "חסר מזהה בקשה" }, { status: 200 });

    // B. Load request
    let request = null;
    try { request = await base44.asServiceRole.entities.CommonSpaceBookingRequest.get(request_id); } catch {}
    if (!request) return Response.json({ success: false, error: "בקשה לא נמצאה" }, { status: 200 });

    if (request.status === "APPROVED") return Response.json({ success: false, error: "הבקשה כבר אושרה" }, { status: 200 });
    if (request.status === "REJECTED" || request.status === "CANCELLED") {
      return Response.json({ success: false, error: "לא ניתן לאשר בקשה שנדחתה או בוטלה" }, { status: 200 });
    }
    if (request.status !== "PENDING" && request.status !== "CHANGE_REQUESTED") {
      return Response.json({ success: false, error: "סטטוס הבקשה אינו מאפשר אישור" }, { status: 200 });
    }

    // C. Validate related records
    let space = null;
    try { space = await base44.asServiceRole.entities.ActivitySpace.get(request.space_id); } catch {}
    if (!space) return Response.json({ success: false, error: "מרחב לא נמצא" }, { status: 200 });
    if (!isMechinaRequestsEnabled(space)) {
      if (request.status === 'PENDING') await rejectPendingMechinaRequests(base44, space.id, user, internalUser, request.id);
      return Response.json({ success: false, request_changed: request.status === 'PENDING', error: MECHINA_DISABLED_REASON });
    }
    if (space.is_bookable === false) return Response.json({ success: false, error: 'המרחב אינו זמין להזמנה כללית' });

    let group = null;
    try { group = await base44.asServiceRole.entities.Group.get(request.mechina_group_id); } catch {}
    if (!group) return Response.json({ success: false, error: "מכינה לא נמצאה" }, { status: 200 });

    // Need operational group profile for GroupScheduleItem required fields
    const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: request.mechina_group_id });
    const profile = profiles[0] || null;

    // D. Final conflict check — include physical temporary blocks
    const activeBlocks = await base44.asServiceRole.entities.ActivitySpaceBlock.filter({ activity_space_id: request.space_id, status: "ACTIVE" });
    const blocking = activeBlocks.find(block => reservationOverlapsBlock(block, request.date, request.start_time, request.end_time));
    if (blocking) {
      return Response.json({ success: false, error: "המרחב הזה לא זמין בזמן הזה", detail: blocking.is_open_ended ? "חסום עד תיקון" : "", block: { space_name: space.name, reason_type: blocking.reason_type, start_date: blocking.start_date, end_date: blocking.end_date, start_time: blocking.start_time, end_time: blocking.end_time, is_open_ended: !!blocking.is_open_ended, notes: blocking.reason_notes || "" } }, { status: 200 });
    }

    const activeBookings = await base44.asServiceRole.entities.GroupScheduleItem.filter({
      activity_space_id: request.space_id,
      date: request.date,
      status: "ACTIVE",
    });
    for (const b of activeBookings) {
      if (timesOverlap(request.start_time, request.end_time, b.start_time, b.end_time)) {
        return Response.json({ success: false, error: "המרחב כבר תפוס בשעה זו" }, { status: 200 });
      }
    }

    // E. Create real GroupScheduleItem
    const notesText = [
      request.notes || "",
      "נוצר מבקשת מרחב של מכינה",
    ].filter(Boolean).join(" | ");

    const scheduleItemData = {
      group_id: request.mechina_group_id,
      operational_group_profile_id: profile?.id || "",
      date: request.date,
      start_time: request.start_time,
      end_time: request.end_time,
      activity_name: request.activity_title,
      activity_space_id: request.space_id,
      activity_space_code: space.code || "",
      pax: request.participants_count || null,
      needs_projector: !!request.needs_projector,
      needs_screen: !!request.needs_screen,
      needs_microphone: !!request.needs_microphone,
      needs_sound: !!request.needs_sound,
      needs_whiteboard: !!request.needs_whiteboard,
      needs_chair_circle: !!request.needs_chair_circle,
      chairs_count: request.chairs_count || null,
      logistics_other: request.logistics_other || "",
      notes: notesText,
      source: "manual",
      status: "ACTIVE",
    };

    const freshSpace = await base44.asServiceRole.entities.ActivitySpace.get(request.space_id);
    if (!isMechinaRequestsEnabled(freshSpace)) {
      if (request.status === 'PENDING') await rejectPendingMechinaRequests(base44, space.id, user, internalUser, request.id);
      return Response.json({ success: false, request_changed: request.status === 'PENDING', error: MECHINA_DISABLED_REASON });
    }
    if (freshSpace.is_bookable === false) return Response.json({ success: false, error: 'המרחב אינו זמין להזמנה כללית' });
    const freshRequest = await base44.asServiceRole.entities.CommonSpaceBookingRequest.get(request_id);
    if (freshRequest.status !== request.status) return Response.json({ success: false, request_changed: true, error: 'מצב הבקשה השתנה. יש לרענן.' });
    const scheduleItem = await base44.asServiceRole.entities.GroupScheduleItem.create(scheduleItemData);

    // F. Conditional decision: never overwrite a rejection that raced this approval.
    await base44.asServiceRole.entities.CommonSpaceBookingRequest.updateMany({ id: request_id, status: request.status }, { $set: {
      status: "APPROVED",
      admin_decision_by_user_id: user.id,
      admin_decision_by_name: internalUser.name || user.full_name || "",
      admin_decision_at: new Date().toISOString(),
      admin_notes: admin_notes || "",
      approved_schedule_item_id: scheduleItem.id,
    } });
    const decided = await base44.asServiceRole.entities.CommonSpaceBookingRequest.get(request_id);
    if (decided.status !== 'APPROVED' || decided.approved_schedule_item_id !== scheduleItem.id) {
      await base44.asServiceRole.entities.GroupScheduleItem.delete(scheduleItem.id);
      return Response.json({ success: false, request_changed: true, error: 'הבקשה השתנתה במהלך האישור. לא נשמרה הזמנה חדשה.' });
    }

    // G. Email requester
    const emailBody = `
<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #222; line-height: 1.7;">
  <p>שלום רב,</p>
  <p>🎉 הבקשה להזמנת מרחב <strong>אושרה</strong>!</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 12px 0;" />
  <p>📍 <strong>מרחב:</strong> ${space.name}</p>
  <p>📅 <strong>תאריך:</strong> ${request.date}</p>
  <p>⏰ <strong>שעות:</strong> ${request.start_time} – ${request.end_time}</p>
  <p>🎯 <strong>שם הפעילות:</strong> ${request.activity_title}</p>
  ${admin_notes ? `<p>💬 <strong>הערת מנהל:</strong> ${admin_notes}</p>` : ""}
  <hr style="border: none; border-top: 1px solid #eee; margin: 12px 0;" />
  <p>בברכה,<br/>מערכת הדור הבא</p>
</div>`.trim();

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: request.requested_by_email,
        subject: "הבקשה להזמנת מרחב אושרה",
        body: emailBody,
      });
    } catch (emailErr) {
      console.warn("Email send failed (non-fatal):", emailErr?.message);
    }

    return Response.json({ success: true, request_id, schedule_item_id: scheduleItem.id });

  } catch (err) {
    console.error("[approveMechinaBookingRequest]", err?.message, err?.stack);
    return Response.json({ success: false, error: "שגיאה פנימית — נסה שוב" }, { status: 500 });
  }
}