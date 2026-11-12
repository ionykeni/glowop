import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { jsPDF } from 'npm:jspdf@4.0.0';
import { resolveInternalRole } from '../../shared/internalRoleAuth.js';
import { buildScheduleReport, filterReportToWorker, validateRange, addDays, weekStartOf } from '../../shared/workScheduleReport.js';
import { buildWorkerPdf, buildTeamPdf } from '../../shared/workSchedulePdf.js';

// Management-only planned-shift reports (on-screen JSON, worker PDF, team PDF) for the Tiful work schedule.
// Read-only. Never returns phone, email or any compensation data.
const MANAGER_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
const PAGE = 500;
const FONT_URLS = {
  regular: 'https://raw.githubusercontent.com/google/fonts/main/ofl/alef/Alef-Regular.ttf',
  bold: 'https://raw.githubusercontent.com/google/fonts/main/ofl/alef/Alef-Bold.ttf',
};
let fontCache = null;

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

async function loadFonts() {
  if (fontCache) return fontCache;
  const [regular, bold] = await Promise.all(Object.values(FONT_URLS).map(async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`FONT_DOWNLOAD_FAILED ${res.status}`);
    return toBase64(await res.arrayBuffer());
  }));
  fontCache = { regular, bold };
  return fontCache;
}

// Reads every matching record; fails loudly instead of truncating.
async function loadAll(entity, query, sort) {
  const out = [];
  const seen = new Set();
  for (let skip = 0; ; skip += PAGE) {
    const page = await entity.filter(query, sort, PAGE, skip);
    let fresh = 0;
    for (const r of page) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); fresh++; }
    if (page.length < PAGE) return out;
    if (fresh === 0) throw new Error('PAGINATION_STALLED');
    if (skip >= 20000) throw new Error('TOO_MANY_RECORDS');
  }
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 || e.status === 403 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'נדרשת התחברות' }, { status: 401 });
    const role = await resolveInternalRole(base44, user);
    if (!MANAGER_ROLES.has(role)) return Response.json({ error: 'אין הרשאה לדוחות סידור העבודה' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'report';
    if (action !== 'report' && action !== 'pdf') return Response.json({ error: 'פעולה לא מוכרת' }, { status: 400 });
    const { start, end } = body;
    const rangeError = validateRange(start, end);
    if (rangeError) return Response.json({ error: rangeError }, { status: 400 });
    const workerId = typeof body.worker_id === 'string' && body.worker_id && body.worker_id !== 'ALL' ? body.worker_id : null;
    if (action === 'pdf' && !['worker', 'team'].includes(body.kind)) return Response.json({ error: 'סוג מסמך לא תקין' }, { status: 400 });
    if (action === 'pdf' && body.kind === 'worker' && !workerId) return Response.json({ error: 'יש לבחור עובד' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    // The day before `start` is loaded so overnight shifts spilling into the period are included.
    const [shifts, weekSchedules, profiles] = await Promise.all([
      loadAll(db.WorkShift, { date: { $gte: addDays(start, -1), $lte: end }, status: 'PLANNED' }, 'date'),
      loadAll(db.WorkSchedule, { week_start_date: { $gte: weekStartOf(addDays(start, -1)), $lte: weekStartOf(end) } }, 'week_start_date'),
      loadAll(db.WorkerProfile, {}, 'full_name'),
    ]);
    const known = new Set(weekSchedules.map((s) => s.id));
    const missingIds = [...new Set(shifts.map((s) => s.work_schedule_id).filter((id) => id && !known.has(id)))];
    const extra = missingIds.length ? await loadAll(db.WorkSchedule, { id: { $in: missingIds } }, 'week_start_date') : [];
    const workers = profiles.map((p) => ({ id: p.id, full_name: p.full_name, default_team: p.default_team }));

    let report = buildScheduleReport({ start, end, shifts, schedules: [...weekSchedules, ...extra], workers });
    if (workerId) report = filterReportToWorker(report, workerId);
    console.log('[getWorkScheduleReport]', JSON.stringify({ action, kind: body.kind || null, start, end, worker: !!workerId, shifts: shifts.length, workers: report.workers.length, warnings: report.warnings.length }));

    if (action === 'report') return Response.json({ report });

    const includeDrafts = body.include_drafts === true;
    const fonts = await loadFonts();
    let doc, filename;
    if (body.kind === 'worker') {
      const worker = report.workers[0];
      if (!worker) {
        const name = profiles.find((p) => p.id === workerId)?.full_name;
        if (!name) return Response.json({ error: 'העובד לא נמצא' }, { status: 404 });
        report = { ...report, workers: [] };
        doc = buildWorkerPdf(jsPDF, fonts, report, { worker_name: name, items: [], published: { planned_minutes: 0, shift_count: 0, on_call_count: 0, overlap_minutes: 0 }, draft: { planned_minutes: 0, shift_count: 0, on_call_count: 0 } }, { includeDrafts });
      } else {
        doc = buildWorkerPdf(jsPDF, fonts, report, worker, { includeDrafts });
      }
      filename = `schedule-worker-${start}-${end}.pdf`;
    } else {
      doc = buildTeamPdf(jsPDF, fonts, report, { includeDrafts });
      filename = `schedule-team-${start}-${end}.pdf`;
    }
    return Response.json({ filename, pages: doc.getNumberOfPages(), pdf_base64: toBase64(doc.output('arraybuffer')) });
  } catch (error) {
    console.error('[getWorkScheduleReport]', error?.message, error?.stack);
    return Response.json({ error: 'שגיאה בהפקת הדוח' }, { status: 500 });
  }
}