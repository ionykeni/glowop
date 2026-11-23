import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { shiftInterval, mergeIntervals } from '../../shared/workScheduleReport.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const internalUsers = await base44.asServiceRole.entities.InternalUser.list("-updated_date", 500);
    const internalUser = internalUsers.find((item) => item.active && item.email?.trim().toLowerCase() === user.email?.trim().toLowerCase());
    if (!internalUser || !["ADMIN", "SUPER_ADMIN"].includes(internalUser.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = await req.json();
    const year = Number(payload.year);
    const month = Number(payload.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return Response.json({ error: "Invalid month" }, { status: 400 });
    }

    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const [shifts, schedules, workers] = await Promise.all([
      base44.asServiceRole.entities.WorkShift.filter({ date: { $gte: start, $lte: end }, status: "PLANNED" }, "date", 5000),
      base44.asServiceRole.entities.WorkSchedule.list("-week_start_date", 1000),
      base44.asServiceRole.entities.WorkerProfile.list("full_name", 1000),
    ]);
    const publishedIds = new Set(schedules.filter((item) => item.status === "PUBLISHED").map((item) => item.id));
    const workerMap = Object.fromEntries(workers.map((item) => [item.id, item]));
    const grouped = {};

    const duration = (startTime, endTime) => {
      if (!startTime || !endTime) return 0;
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
      let minutes = (eh * 60 + em) - (sh * 60 + sm);
      if (minutes < 0) minutes += 24 * 60;
      return minutes / 60;
    };

    for (const shift of shifts) {
      if (!publishedIds.has(shift.work_schedule_id) || !shift.worker_id) continue;
      const worker = workerMap[shift.worker_id];
      const row = grouped[shift.worker_id] || { worker_id: shift.worker_id, worker_name: worker?.full_name || shift.worker_name || "ללא שם", team: worker?.default_team || "OTHER", dates: new Set(), night_dates: new Set(), morning_shifts: 0, evening_shifts: 0, estimated_hours: 0, details: [], intervals: [] };
      const isNight = shift.row_type === "NIGHT_ON_CALL";
      const hours = isNight ? 0 : duration(shift.start_time, shift.end_time);
      const startHour = Number((shift.start_time || "12:00").split(":")[0]);
      const isEvening = shift.row_type.includes("EVENING") || (!shift.row_type.includes("MORNING") && startHour >= 14);
      row.dates.add(shift.date);
      if (isNight) row.night_dates.add(shift.date);
      else if (isEvening) row.evening_shifts += 1;
      else row.morning_shifts += 1;
      // The worker total counts overlapping shifts once (same union rule as the shared schedule report).
      const iv = isNight ? null : shiftInterval(shift);
      if (iv?.valid) row.intervals.push([iv.startMs, iv.endMs]);
      row.details.push({ date: shift.date, row_type: shift.row_type, row_label: shift.row_label || shift.row_type, start_time: shift.start_time || "", end_time: shift.end_time || "", estimated_hours: hours, is_night_on_call: isNight });
      grouped[shift.worker_id] = row;
    }

    const report = Object.values(grouped).map(({ intervals, ...row }) => ({ ...row, total_days: row.dates.size, total_shifts: row.details.length, night_on_call_count: row.night_dates.size, dates: [...row.dates].sort(), night_dates: [...row.night_dates].sort(), estimated_hours: Math.round(mergeIntervals(intervals).reduce((t, [a, b]) => t + b - a, 0) / 36000) / 100, details: row.details.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)) })).sort((a, b) => a.worker_name.localeCompare(b.worker_name, "he"));
    return Response.json({ period: { year, month, start, end }, workers: report, disclaimer: "הנתונים הם הערכה לפי סידור העבודה שפורסם ואינם תחליף לדוח הנוכחות הרשמי ב-Connecteam." });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}