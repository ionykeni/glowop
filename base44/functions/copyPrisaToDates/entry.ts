import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateDatedOperationalDate } from '../../shared/datedOperationalPeriodValidation.js';

const normalize = (value) => String(value || '').trim().toLowerCase();
const allowedRoles = new Set(['SUPER_ADMIN', 'ADMIN']);
const effectiveQuantity = (quantity, type) => type === 'DOUBLE' ? quantity * 2 : type === 'ONE_AND_HALF' ? quantity * 1.5 : quantity;

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const internalUsers = await base44.asServiceRole.entities.InternalUser.filter({ email: normalize(user.email) });
    const caller = internalUsers.find((item) => normalize(item.email) === normalize(user.email) && item.active !== false);
    if (!caller || !allowedRoles.has(caller.role)) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    if (!body.source_prisa_id || !Array.isArray(body.target_dates)) return Response.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
    const targetDates = [...new Set(body.target_dates.map(String))];
    if (targetDates.length > 400) return Response.json({ error: 'TOO_MANY_DATES' }, { status: 400 });

    let source;
    try { source = await base44.asServiceRole.entities.PrisaRequest.get(body.source_prisa_id); }
    catch { return Response.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 }); }
    if (source.status !== 'ACTIVE') return Response.json({ error: 'SOURCE_NOT_ACTIVE' }, { status: 409 });

    const group = await base44.asServiceRole.entities.Group.get(source.group_id);
    const profiles = await base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: source.group_id });
    const profile = profiles.find((item) => item.id === source.operational_group_profile_id) || profiles[0] || null;
    const start = group.arrival_date || '';
    const end = group.departure_date || '';
    const invalidDates = [];
    for (const date of targetDates) {
      const validEnvelopeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && start && end && date >= start && date <= end;
      const periodValidation = validEnvelopeDate ? await validateDatedOperationalDate(base44, group, date) : { valid: false };
      if (!validEnvelopeDate || !periodValidation.valid) invalidDates.push(date);
    }
    const validDates = targetDates.filter((date) => !invalidDates.includes(date));

    const participants = group.participant_count ?? profile?.participant_count;
    const staff = group.staff_count ?? profile?.staff_count;
    const autoQuantity = participants != null && staff != null ? Number(participants) + Number(staff) : participants != null ? Number(participants) : Number(group.total_pax ?? profile?.total_pax ?? source.quantity);
    if (!Number.isFinite(autoQuantity) || autoQuantity <= 0) return Response.json({ error: 'PAX_NOT_AVAILABLE' }, { status: 409 });

    const existing = await base44.asServiceRole.entities.PrisaRequest.filter({ group_id: source.group_id });
    const duplicateKey = (item) => `${item.date}|${item.type}|${item.pickup_slot}`;
    const existingKeys = new Set(existing.filter((item) => item.status !== 'CANCELLED').map(duplicateKey));
    const skippedExisting = validDates.filter((date) => existingKeys.has(`${date}|${source.type}|${source.pickup_slot}`));
    const datesToCreate = validDates.filter((date) => !existingKeys.has(`${date}|${source.type}|${source.pickup_slot}`));
    const payloads = datesToCreate.map((date) => ({
      group_id: source.group_id,
      operational_group_profile_id: source.operational_group_profile_id,
      date,
      quantity: autoQuantity,
      type: source.type,
      pickup_slot: source.pickup_slot,
      effective_quantity: effectiveQuantity(autoQuantity, source.type),
      notes: source.notes || '',
      source: 'MANUAL',
      status: 'ACTIVE',
    }));
    const created = payloads.length ? await base44.asServiceRole.entities.PrisaRequest.bulkCreate(payloads) : [];
    return Response.json({ success: true, source, created, skipped_existing: skippedExisting, invalid_dates: invalidDates });
  } catch (error) {
    return Response.json({ error: error.message || 'COPY_PRISA_FAILED' }, { status: 500 });
  }
}