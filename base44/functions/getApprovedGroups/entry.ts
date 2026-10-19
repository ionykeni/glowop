import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const filters = await req.json();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const missingDeparture = { $or: [
      { departure_date: { $exists: false } }, { departure_date: null }, { departure_date: '' },
    ] };
    const conditions = [{ status: 'CONFIRMED', operationally_active: { $ne: false } }];
    const search = String(filters.searchQuery || '').trim();
    if (search) {
      const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      conditions.push({ $or: ['group_name', 'contact_name', 'contact_phone', 'contact_email', 'internal_notes']
        .map(field => ({ [field]: { $regex: pattern, $options: 'i' } })) });
    }
    if (['LODGING', 'DAY_USE'].includes(filters.typeFilter)) conditions.push({ group_type: filters.typeFilter });
    const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    let lower = validDate(filters.dateStart) ? filters.dateStart : null;
    let upper = validDate(filters.dateEnd) ? filters.dateEnd : null;
    if (typeof filters.monthFilter === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.monthFilter)) {
      const monthStart = `${filters.monthFilter}-01`;
      const [year, month] = filters.monthFilter.split('-').map(Number);
      const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      lower = lower && lower > monthStart ? lower : monthStart;
      upper = upper && upper < monthEnd ? upper : monthEnd;
    }
    if (lower) conditions.push({ $or: [
      { departure_date: { $gte: lower } },
      { $and: [missingDeparture, { arrival_date: { $gte: lower } }] },
    ] });
    if (upper) conditions.push({ arrival_date: { $lte: upper } });

    // Choose groups by stay dates first, then join ACCEPTED profiles. The
    // acceptance timestamp never participates in selection or ordering.
    const groups = [];
    const profiles = [];
    const segments = [
      { query: { $or: [{ departure_date: { $gte: today } }, missingDeparture] }, sort: 'arrival_date' },
      { query: { departure_date: { $lt: today, $nin: ['', null] } }, sort: '-arrival_date' },
    ];
    for (const segment of segments) {
      let cursor;
      do {
        const page = await base44.entities.Group.filter({ $and: [...conditions, segment.query] }, {
          sort: segment.sort, limit: 50, ...(cursor ? { cursor } : {}),
        });
        if (!page.items.length) break;
        const byGroup = new Map();
        let profileCursor;
        do {
          const matched = await base44.entities.OperationalGroupProfile.filter({
            group_id: { $in: page.items.map(group => group.id) }, status: 'ACCEPTED',
          }, { sort: 'id', limit: 200, ...(profileCursor ? { cursor: profileCursor } : {}) });
          for (const profile of matched.items) {
            if (!byGroup.has(profile.group_id)) byGroup.set(profile.group_id, []);
            byGroup.get(profile.group_id).push(profile);
          }
          profileCursor = matched.has_more ? matched.next_cursor : null;
        } while (profileCursor);
        for (const group of page.items) {
          const accepted = byGroup.get(group.id) || [];
          if (!accepted.length) continue;
          groups.push(group);
          profiles.push(...accepted.slice(0, 200 - profiles.length));
          if (profiles.length === 200) break;
        }
        cursor = page.has_more ? page.next_cursor : null;
      } while (cursor && profiles.length < 200);
      if (profiles.length === 200) break;
    }
    const groupMap = new Map(groups.map(group => [group.id, group]));
    profiles.sort((a, b) => (groupMap.get(a.group_id).arrival_date || '').localeCompare(groupMap.get(b.group_id).arrival_date || ''));
    return Response.json({ groups, profiles, today });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}