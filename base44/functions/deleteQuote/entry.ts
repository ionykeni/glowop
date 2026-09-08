import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });

    const normalizedEmail = user.email.trim().toLowerCase();
    const internalUsers = await base44.asServiceRole.entities.InternalUser.list();
    const internalUser = internalUsers.find(row => row.email?.trim().toLowerCase() === normalizedEmail);
    const role = internalUser?.role || user.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'QUOTES_MANAGER'].includes(role)) {
      return Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const { quote_id } = await req.json().catch(() => ({}));
    if (!quote_id || typeof quote_id !== 'string') return Response.json({ success: false, error: 'QUOTE_ID_REQUIRED' }, { status: 400 });
    const quote = await base44.asServiceRole.entities.Quote.get(quote_id).catch(() => null);
    if (!quote) return Response.json({ success: true, status: 'already_deleted', quote_id });
    if (quote.status === 'APPROVED') {
      return Response.json({ success: false, error: 'BUSINESS_INTEGRITY_BLOCK', message: 'לא ניתן למחוק הצעת מחיר מאושרת לצמיתות.', quote_id, group_id: quote.group_id || null }, { status: 409 });
    }
    const quoteSubmissions = await base44.asServiceRole.entities.GuestFormSubmission.filter({ quote_id });
    if (quoteSubmissions.length > 0) {
      return Response.json({ success: false, error: 'BUSINESS_INTEGRITY_BLOCK', message: 'להצעת המחיר קיימת הגשת אורח ולכן לא ניתן למחוק אותה לצמיתות.', quote_id, group_id: quote.group_id || null }, { status: 409 });
    }

    let group = null;
    if (quote.group_id) {
      const groups = await base44.asServiceRole.entities.Group.filter({ id: quote.group_id });
      group = groups[0] || null;
    }

    let profiles = [];
    let formLinks = [];
    if (group) {
      const checks = await Promise.all([
        base44.asServiceRole.entities.OperationalGroupProfile.filter({ group_id: group.id }),
        base44.asServiceRole.entities.GroupExternalFormLink.filter({ group_id: group.id }),
        base44.asServiceRole.entities.GuestFormSubmission.filter({ group_id: group.id }),
        base44.asServiceRole.entities.SleepingAllocation.filter({ group_id: group.id }),
        base44.asServiceRole.entities.MealReservation.filter({ group_id: group.id }),
        base44.asServiceRole.entities.GroupScheduleItem.filter({ group_id: group.id }),
        base44.asServiceRole.entities.GroupStayPeriod.filter({ group_id: group.id }),
        base44.asServiceRole.entities.NeighborhoodReservation.filter({ group_id: group.id }),
        base44.asServiceRole.entities.CoffeeCornerRequest.filter({ group_id: group.id }),
        base44.asServiceRole.entities.PrisaRequest.filter({ group_id: group.id }),
        base44.asServiceRole.entities.OperationalHold.filter({ group_id: group.id }),
        base44.asServiceRole.entities.PostStayReport.filter({ group_id: group.id }),
        base44.asServiceRole.entities.PostStayIncident.filter({ group_id: group.id }),
        base44.asServiceRole.entities.OperationalStayChange.filter({ group_id: group.id }),
        base44.asServiceRole.entities.OperationalStayReconciliation.filter({ group_id: group.id }),
        base44.asServiceRole.entities.CommonSpaceBookingRequest.filter({ mechina_group_id: group.id }),
        base44.asServiceRole.entities.MaintenanceIssue.filter({ related_group_id: group.id }),
      ]);
      [profiles, formLinks] = checks;
      const operationalCounts = checks.slice(2).map(rows => rows.length);
      const hasOperationalActivity = operationalCounts.some(count => count > 0);
      const isPurePreparationDraft = quote.preparation_flow_enabled === true && group.quote_preparation_flow === true && group.status === 'DRAFT';
      if (hasOperationalActivity || (isPurePreparationDraft && profiles.length > 1)) {
        return Response.json({
          success: false,
          error: 'BUSINESS_INTEGRITY_BLOCK',
          message: 'הצעת המחיר כבר יצרה פעילות תפעולית ולכן לא ניתן למחוק אותה לצמיתות.',
          quote_id,
          group_id: group.id,
        }, { status: 409 });
      }
    }

    const quoteOptions = await base44.asServiceRole.entities.QuoteOption.filter({ quote_id });
    await Promise.all(quoteOptions.map(row => base44.asServiceRole.entities.QuoteOption.delete(row.id)));

    const removePreparationArtifacts = group && quote.preparation_flow_enabled === true && group.quote_preparation_flow === true && group.status === 'DRAFT';
    if (removePreparationArtifacts) {
      await Promise.all(formLinks.map(row => base44.asServiceRole.entities.GroupExternalFormLink.delete(row.id)));
      await Promise.all(profiles.map(row => base44.asServiceRole.entities.OperationalGroupProfile.delete(row.id)));
    } else {
      const linkedProfiles = profiles.filter(row => String(row.quote_id || '') === quote_id);
      await Promise.all(linkedProfiles.map(row => base44.asServiceRole.entities.OperationalGroupProfile.updateMany({ id: row.id }, { $unset: { quote_id: '' } })));
    }

    await base44.asServiceRole.entities.Quote.delete(quote_id);
    if (removePreparationArtifacts) await base44.asServiceRole.entities.Group.delete(group.id);

    return Response.json({
      success: true,
      status: 'deleted',
      quote_id,
      group_id: group?.id || null,
      deleted_quote_options: quoteOptions.length,
      deleted_preparation_group: Boolean(removePreparationArtifacts),
    });
  } catch (error) {
    console.error('[deleteQuote]', error?.message);
    return Response.json({ success: false, error: 'DELETE_QUOTE_FAILED', message: error?.message }, { status: 500 });
  }
}