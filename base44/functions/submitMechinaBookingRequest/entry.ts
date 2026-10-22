import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { isMechinaRequestsEnabled, MECHINA_DISABLED_REASON } from '../../shared/mechinaSpaceEligibility.js';

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
    const base44 = guardOperationalClient(createClientFromRequest(req));

    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ success: false, error: "לא מחובר" }, { status: 401 });

    const body = await req.json();
    const {
      mechina_group_id, space_id, date, start_time, end_time,
      activity_title, participants_count,
      needs_projector, needs_screen, needs_microphone, needs_sound,
      needs_whiteboard, needs_chair_circle, chairs_count, logistics_other,
      notes,
    } = body;

    // ── Required field validation ────────────────────────────────────────────
    if (!mechina_group_id) return Response.json({ success: false, error: "חסר מזהה מכינה" }, { status: 200 });
    if (!space_id)         return Response.json({ success: false, error: "חסר מרחב" }, { status: 200 });
    if (!date)             return Response.json({ success: false, error: "חסר תאריך" }, { status: 200 });
    if (!start_time)       return Response.json({ success: false, error: "חסרה שעת התחלה" }, { status: 200 });
    if (!end_time)         return Response.json({ success: false, error: "חסרה שעת סיום" }, { status: 200 });
    if (!activity_title)   return Response.json({ success: false, error: "חסר שם הפעילות" }, { status: 200 });

    if (timeToMinutes(end_time) <= timeToMinutes(start_time)) {
      return Response.json({ success: false, error: "שעת סיום חייבת להיות אחרי שעת התחלה" }, { status: 200 });
    }

    // ── Fetch InternalUser to check role ────────────────────────────────────
    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email });
    const internalUser = internalUsers[0];
    const userRole = internalUser?.role || null;
    const isAdmin = ADMIN_ROLES.includes(userRole);

    // ── Verify group assignment if not admin ─────────────────────────────────
    if (!isAdmin) {
      const assignments = await base44.asServiceRole.entities.MechinaGroupAssignment.filter({
        user_email: user.email,
        group_id: mechina_group_id,
        is_active: true,
      });
      if (!assignments || assignments.length === 0) {
        return Response.json({ success: false, error: "אין הרשאה לשלוח בקשה עבור מכינה זו" }, { status: 200 });
      }
    }

    // ── Validate space exists ────────────────────────────────────────────────
    let space = null;
    try {
      space = await base44.asServiceRole.entities.ActivitySpace.get(space_id);
    } catch {}
    if (!space) return Response.json({ success: false, error: "מרחב לא נמצא" }, { status: 200 });

    if (!isMechinaRequestsEnabled(space)) {
      return Response.json({ success: false, error: MECHINA_DISABLED_REASON }, { status: 200 });
    }
    if (space.is_bookable === false) {
      return Response.json({ success: false, error: 'המרחב אינו זמין להזמנה כללית' }, { status: 200 });
    }

    // ── Validate group exists ────────────────────────────────────────────────
    let group = null;
    try {
      group = await base44.asServiceRole.entities.Group.get(mechina_group_id);
    } catch {}
    if (!group) return Response.json({ success: false, error: "מכינה לא נמצאה" }, { status: 200 });

    // ── Only relevant/active groups may submit Mechina requests ─────────────
    const RELEVANT_GROUP_STATUSES = ["CONFIRMED", "PENDING_APPROVAL"];
    if (!RELEVANT_GROUP_STATUSES.includes(group.status)) {
      return Response.json({ success: false, error: "הקבוצה הזו לא זמינה לבקשות מכינה" }, { status: 200 });
    }

    const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: mechina_group_id });
    const profile = profiles[0] || null;

    // ── Physical space blocks are the source of truth for temporary closures ──
    const activeBlocks = await base44.asServiceRole.entities.ActivitySpaceBlock.filter({
      activity_space_id: space_id,
      status: "ACTIVE",
    });
    const blocking = activeBlocks.find(block => reservationOverlapsBlock(block, date, start_time, end_time));
    if (blocking) {
      return Response.json({
        success: false,
        error: "המרחב הזה לא זמין בזמן הזה",
        detail: blocking.is_open_ended ? "חסום עד תיקון" : "",
        block: { space_name: space.name, reason_type: blocking.reason_type, start_date: blocking.start_date, end_date: blocking.end_date, start_time: blocking.start_time, end_time: blocking.end_time, is_open_ended: !!blocking.is_open_ended, notes: blocking.reason_notes || "" },
      }, { status: 200 });
    }

    // ── Conflict A: ACTIVE GroupScheduleItem ────────────────────────────────
    const activeBookings = await base44.asServiceRole.entities.GroupScheduleItem.filter({
      activity_space_id: space_id,
      date: date,
      status: "ACTIVE",
    });
    for (const b of activeBookings) {
      if (timesOverlap(start_time, end_time, b.start_time, b.end_time)) {
        return Response.json({ success: false, error: "המרחב תפוס בשעה זו" }, { status: 200 });
      }
    }

    // ── Conflict B: PENDING CommonSpaceBookingRequest ────────────────────────
    const pendingRequests = await base44.asServiceRole.entities.CommonSpaceBookingRequest.filter({
      space_id: space_id,
      date: date,
      status: "PENDING",
    });
    for (const r of pendingRequests) {
      if (timesOverlap(start_time, end_time, r.start_time, r.end_time)) {
        return Response.json({ success: false, error: "כבר קיימת בקשה ממתינה לאישור עבור מרחב זה בשעה זו" }, { status: 200 });
      }
    }

    // ── Save and auto-approve atomically from the user's perspective ──────────
    let newRequest = null;
    let scheduleItem = null;
    try {
      newRequest = await base44.asServiceRole.entities.CommonSpaceBookingRequest.create({
        mechina_group_id,
        requested_by_user_id: user.id,
        requested_by_name: internalUser?.name || user.full_name || "",
        requested_by_email: user.email,
        space_id,
        space_name: space.name || "",
        date,
        start_time,
        end_time,
        activity_title,
        participants_count: participants_count || null,
        needs_projector: !!needs_projector,
        needs_screen: !!needs_screen,
        needs_microphone: !!needs_microphone,
        needs_sound: !!needs_sound,
        needs_whiteboard: !!needs_whiteboard,
        needs_chair_circle: !!needs_chair_circle,
        chairs_count: chairs_count || null,
        logistics_other: logistics_other || "",
        notes: notes || "",
        status: "PENDING",
      });

      // Refresh immediately before booking: an admin may have disabled this space while checks ran.
      const currentSpace = await base44.asServiceRole.entities.ActivitySpace.get(space_id);
      const currentRequest = await base44.asServiceRole.entities.CommonSpaceBookingRequest.get(newRequest.id);
      if (!isMechinaRequestsEnabled(currentSpace) || currentSpace.is_bookable === false || currentRequest.status !== 'PENDING') {
        // Only this newly-created, unbooked request is cleaned up; existing reservations are untouched.
        if (currentRequest.status === 'PENDING') await base44.asServiceRole.entities.CommonSpaceBookingRequest.delete(newRequest.id);
        return Response.json({ success: false, error: 'הזמינות השתנתה במהלך השליחה. לא נוצרה הזמנה; יש לרענן את הטופס.' });
      }
      scheduleItem = await base44.asServiceRole.entities.GroupScheduleItem.create({
        group_id: mechina_group_id,
        operational_group_profile_id: profile?.id || "",
        date,
        start_time,
        end_time,
        activity_name: activity_title,
        activity_space_id: space_id,
        activity_space_code: space.code || "",
        pax: participants_count || null,
        needs_projector: !!needs_projector,
        needs_screen: !!needs_screen,
        needs_microphone: !!needs_microphone,
        needs_sound: !!needs_sound,
        needs_whiteboard: !!needs_whiteboard,
        needs_chair_circle: !!needs_chair_circle,
        chairs_count: chairs_count || null,
        logistics_other: logistics_other || "",
        notes: [notes || "", "נוצר ואושר אוטומטית מבקשת מרחב של מכינה"].filter(Boolean).join(" | "),
        source: "manual",
        status: "ACTIVE",
      });

      await base44.asServiceRole.entities.CommonSpaceBookingRequest.updateMany({ id: newRequest.id, status: 'PENDING' }, { $set: {
        status: 'APPROVED', admin_decision_by_name: 'אישור אוטומטי',
        admin_decision_at: new Date().toISOString(), approved_schedule_item_id: scheduleItem.id,
      } });
      const decidedRequest = await base44.asServiceRole.entities.CommonSpaceBookingRequest.get(newRequest.id);
      if (decidedRequest.status !== 'APPROVED' || decidedRequest.approved_schedule_item_id !== scheduleItem.id) {
        await base44.asServiceRole.entities.GroupScheduleItem.delete(scheduleItem.id);
        scheduleItem = null;
        return Response.json({ success: false, error: 'הבקשה השתנתה במהלך השליחה. לא נשמרה הזמנה חדשה.' });
      }
    } catch (persistError) {
      if (scheduleItem?.id) await base44.asServiceRole.entities.GroupScheduleItem.delete(scheduleItem.id).catch(() => null);
      if (newRequest?.id) await base44.asServiceRole.entities.CommonSpaceBookingRequest.delete(newRequest.id).catch(() => null);
      throw persistError;
    }

    const emailBody = `
<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #222; line-height: 1.7;">
  <p>שלום רב,</p>
  <p>הבקשה להזמנת מרחב <strong>אושרה אוטומטית</strong>.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 12px 0;" />
  <p>📍 <strong>מרחב:</strong> ${space.name}</p>
  <p>📅 <strong>תאריך:</strong> ${date}</p>
  <p>⏰ <strong>שעות:</strong> ${start_time} – ${end_time}</p>
  <p>🎯 <strong>שם הפעילות:</strong> ${activity_title}</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 12px 0;" />
  <p>בברכה,<br/>מערכת הדור הבא</p>
</div>`.trim();

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: user.email,
        subject: "הבקשה להזמנת מרחב אושרה",
        body: emailBody,
      });
    } catch (emailErr) {
      console.warn("Email send failed (non-fatal):", emailErr?.message);
    }

    return Response.json({ success: true, request_id: newRequest.id, schedule_item_id: scheduleItem.id, status: "APPROVED" });

  } catch (err) {
    console.error("[submitMechinaBookingRequest]", err?.message, err?.stack);
    return Response.json({ success: false, error: "שגיאה פנימית — נסה שוב" }, { status: 500 });
  }
}