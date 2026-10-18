import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { buildSnapshot, compareSnapshots } from '../../shared/mechinaSleepingReportCore.js';

// Informational module only — reads operational data, writes ONLY to
// MechinaSleepingReportDraft / MechinaSleepingReportVersion.
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'];
const ok = (data) => Response.json({ success: true, ...data });
const fail = (error, status = 200) => Response.json({ success: false, error }, { status });

async function authorize(sr, user, groupId) {
  const internal = (await sr.entities.InternalUser.filter({ email: user.email }))[0];
  const role = internal?.role || null;
  const isAdmin = ADMIN_ROLES.includes(role) && internal?.active !== false;
  if (!groupId) return { isAdmin, internal, allowed: isAdmin };
  if (isAdmin) return { isAdmin, internal, allowed: true };
  if (role !== 'MECHINA_USER') return { isAdmin, internal, allowed: false };
  const a = await sr.entities.MechinaGroupAssignment.filter({ user_email: user.email, group_id: groupId, is_active: true });
  return { isAdmin, internal, allowed: a.length > 0 };
}

async function loadPeriods(sr, group) {
  if (group.stay_mode === 'MULTI_PERIOD') {
    const ps = await sr.entities.GroupStayPeriod.filter({ group_id: group.id, status: 'ACTIVE' });
    return ps.sort((a, b) => a.start_date.localeCompare(b.start_date))
      .map(p => ({ key: p.id, start: p.start_date, end: p.end_date }));
  }
  return [{ key: 'CONTINUOUS', start: group.arrival_date, end: group.departure_date || group.arrival_date }];
}

async function loadContext(sr, group, periodKey) {
  const periods = await loadPeriods(sr, group);
  const period = periods.find(p => p.key === periodKey) || periods[0];
  if (!period) return { periods, period: null };
  const [profiles, allocs, tents, nbs] = await Promise.all([
    sr.entities.OperationalGroupProfile.filter({ group_id: group.id }),
    sr.entities.SleepingAllocation.filter({ group_id: group.id, status: 'CONFIRMED' }),
    sr.entities.Tent.list('code', 1000),
    sr.entities.Neighborhood.list('sort_order', 100),
  ]);
  const profile = profiles[0] || {};
  const expected = (Number(profile.boys_count || 0) + Number(profile.girls_count || 0))
    || Number(profile.participant_count || group.participant_count || 0);
  const officialByTent = {};
  for (const a of allocs) {
    if (a.allocation_type !== 'STUDENT') continue;
    const start = a.segment_start_date || a.arrival_date;
    const end = a.segment_end_date || a.departure_date;
    if (!(start < period.end && end > period.start) && !(period.start === period.end && start <= period.start && end >= period.end)) continue;
    officialByTent[a.tent_id] = (officialByTent[a.tent_id] || 0) + Number(a.allocated_pax || 0);
  }
  const tentMap = Object.fromEntries(tents.map(t => [t.id, {
    id: t.id, code: t.code, capacity: t.capacity || 0, neighborhood_id: t.neighborhood_id,
    official_pax: officialByTent[t.id] || 0,
  }]));
  const nbMap = Object.fromEntries(nbs.map(n => [n.id, { id: n.id, name: n.name, code: n.code, sort_order: n.sort_order }]));
  return { periods, period, expected, tentMap, nbMap, assignedIds: new Set(Object.keys(officialByTent)) };
}

const versionMeta = (v) => ({
  id: v.id, version_number: v.version_number, status: v.status, is_current: v.is_current,
  submitted_at: v.submitted_at, submitted_by_name: v.submitted_by_name, submitted_by_email: v.submitted_by_email,
  expected_students: v.expected_students, total_boys: v.total_boys, total_girls: v.total_girls,
  total_students: v.total_students, difference: v.difference, warnings_count: v.warnings_count,
  has_pdf: !!v.pdf_file_uri, group_id: v.group_id, group_name: v.group_name, period_key: v.period_key,
  period_start: v.period_start, period_end: v.period_end,
});

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return fail('לא מחובר', 401);
    const sr = base44.asServiceRole;
    const body = await req.json();
    const { action } = body;

    if (action === 'admin_list') {
      const auth = await authorize(sr, user, null);
      if (!auth.isAdmin) return fail('אין הרשאה', 403);
      const current = await sr.entities.MechinaSleepingReportVersion.filter({ is_current: true }, '-submitted_at', 500);
      return ok({ reports: current.map(versionMeta) });
    }

    // All other actions are scoped to one group (server-verified)
    let version = null;
    let groupId = body.group_id;
    if (body.version_id) {
      try { version = await sr.entities.MechinaSleepingReportVersion.get(body.version_id); } catch {}
      if (!version) return fail('גרסה לא נמצאה');
      groupId = version.group_id;
    }
    if (!groupId) return fail('חסרה קבוצה');
    const auth = await authorize(sr, user, groupId);
    if (!auth.allowed) return fail('אין הרשאה לקבוצה זו', 403);
    let group = null;
    try { group = await sr.entities.Group.get(groupId); } catch {}
    if (!group) return fail('הקבוצה לא נמצאה');

    if (action === 'pdf_url') {
      if (!version?.pdf_file_uri) return fail('אין PDF לגרסה זו');
      const r = await sr.integrations.Core.CreateFileSignedUrl({ file_uri: version.pdf_file_uri, expires_in: 3600 });
      return ok({ url: r.signed_url });
    }

    if (action === 'version_detail') {
      return ok({ version: { ...versionMeta(version), snapshot: JSON.parse(version.snapshot_json || '{}'), comparison: version.comparison_json ? JSON.parse(version.comparison_json) : null } });
    }

    if (action === 'attach_pdf') {
      if (!version) return fail('חסרה גרסה');
      if (version.status !== 'PENDING_PDF' || version.pdf_file_uri) return fail('לגרסה זו כבר צורף PDF — גרסה שהוגשה אינה ניתנת לשינוי');
      if (version.submitted_by_email !== user.email && !auth.isAdmin) return fail('אין הרשאה', 403);
      if (!body.file_uri || typeof body.file_uri !== 'string') return fail('חסר קובץ');
      const prevCurrent = await sr.entities.MechinaSleepingReportVersion.filter({ report_key: version.report_key, is_current: true });
      await sr.entities.MechinaSleepingReportVersion.update(version.id, {
        pdf_file_uri: body.file_uri, pdf_attached_at: new Date().toISOString(), status: 'SUBMITTED', is_current: true,
      });
      await Promise.all(prevCurrent.filter(v => v.id !== version.id).map(v => sr.entities.MechinaSleepingReportVersion.update(v.id, { is_current: false })));
      const drafts = await sr.entities.MechinaSleepingReportDraft.filter({ report_key: version.report_key });
      await Promise.all(drafts.map(d => sr.entities.MechinaSleepingReportDraft.delete(d.id)));
      return ok({ version_id: version.id });
    }

    const ctx = await loadContext(sr, group, body.period_key);
    if (!ctx.period) return fail('לא נמצאה תקופת שהייה לקבוצה');
    const reportKey = `${group.id}:${ctx.period.key}`;

    if (action === 'context') {
      const [drafts, versions] = await Promise.all([
        sr.entities.MechinaSleepingReportDraft.filter({ report_key: reportKey }),
        sr.entities.MechinaSleepingReportVersion.filter({ report_key: reportKey }, '-version_number', 200),
      ]);
      const latest = versions.find(v => v.status === 'SUBMITTED' && v.is_current);
      const draft = drafts[0];
      return ok({
        group: { id: group.id, group_name: group.group_name },
        periods: ctx.periods, period: ctx.period, expected_students: ctx.expected,
        tents: Object.values(ctx.tentMap), neighborhoods: Object.values(ctx.nbMap),
        assigned_tent_ids: [...ctx.assignedIds],
        draft: draft ? { entries: JSON.parse(draft.entries_json || '[]'), general_notes: draft.general_notes || '', updated_at: draft.updated_at_server } : null,
        latest_entries: latest ? JSON.parse(latest.snapshot_json || '{}').entries || [] : null,
        latest_notes: latest ? JSON.parse(latest.snapshot_json || '{}').general_notes || '' : '',
        versions: versions.map(versionMeta),
      });
    }

    if (action === 'save_draft') {
      const payload = {
        report_key: reportKey, group_id: group.id, period_key: ctx.period.key,
        entries_json: JSON.stringify(body.entries || []).slice(0, 200000),
        general_notes: String(body.general_notes || '').slice(0, 2000),
        updated_by_email: user.email, updated_at_server: new Date().toISOString(),
      };
      const existing = await sr.entities.MechinaSleepingReportDraft.filter({ report_key: reportKey });
      if (existing[0]) await sr.entities.MechinaSleepingReportDraft.update(existing[0].id, payload);
      else await sr.entities.MechinaSleepingReportDraft.create(payload);
      return ok({ saved_at: payload.updated_at_server });
    }

    if (action === 'submit') {
      const snap = buildSnapshot(body.entries, ctx.tentMap, ctx.nbMap, ctx.assignedIds);
      if (snap.errors.length) return fail(snap.errors.join(' · '));
      const all = await sr.entities.MechinaSleepingReportVersion.filter({ report_key: reportKey }, '-version_number', 200);
      const prev = all.find(v => v.status === 'SUBMITTED' && v.is_current);
      const prevSnap = prev ? JSON.parse(prev.snapshot_json || '{}') : null;
      const submittedAt = new Date().toISOString();
      const snapshot = {
        ...snap, errors: undefined,
        general_notes: String(body.general_notes || '').slice(0, 2000),
        expected_students: ctx.expected,
        group_name: group.group_name, period: ctx.period,
      };
      const versionNumber = (all[0]?.version_number || 0) + 1;
      const cmp = compareSnapshots(prevSnap, snapshot);
      const comparison = cmp ? { ...cmp, prev_version_number: prev.version_number } : null;
      const created = await sr.entities.MechinaSleepingReportVersion.create({
        report_key: reportKey, group_id: group.id, group_name: group.group_name,
        period_key: ctx.period.key, period_start: ctx.period.start, period_end: ctx.period.end,
        version_number: versionNumber, status: 'PENDING_PDF', is_current: false,
        submitted_at: submittedAt, submitted_by_user_id: user.id, submitted_by_email: user.email,
        submitted_by_name: auth.internal?.name || user.full_name || user.email,
        expected_students: ctx.expected, total_boys: snap.totals.boys, total_girls: snap.totals.girls,
        total_students: snap.totals.total, difference: snap.totals.total - ctx.expected,
        warnings_count: snap.entries.reduce((n, e) => n + e.warnings.length, 0),
        snapshot_json: JSON.stringify(snapshot),
        comparison_json: comparison ? JSON.stringify(comparison) : null,
      });
      return ok({ version: { ...versionMeta(created), snapshot, comparison } });
    }

    return fail('פעולה לא מוכרת');
  } catch (err) {
    console.error('[mechinaSleepingReport]', err?.message, err?.stack);
    return fail('שגיאה פנימית — נסה שוב', 500);
  }
}