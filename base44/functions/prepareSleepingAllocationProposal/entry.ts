import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { isLogisticsManagerEmail } from '../../shared/logisticsAssistantData.js';
import { operationalSleepingMaxPax, sleepingDatesOverlap } from '../../shared/sleepingConfirmation.js';
import { isGroupOperationallyEnabled } from '../../shared/groupOperationalIsolation.js';

// Prepares a NON-operational sleeping proposal. Never writes SleepingAllocation / NeighborhoodReservation.
// The admin reviews it inside the existing לינה tab and saves through the existing confirm/commit path.

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

function matchNeighborhood(neighborhoods, token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, '');
  return neighborhoods.find(n => n.id === t)
    || neighborhoods.find(n => String(n.code || '').toLowerCase() === t.toLowerCase())
    || neighborhoods.find(n => n.name === t)
    || (digits ? neighborhoods.find(n => String(n.code || '').replace(/\D/g, '') === digits || String(n.name || '').replace(/\D/g, '') === digits) : null)
    || null;
}


export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isLogisticsManagerEmail(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const groupId = String(body.group_id || '').trim();
    const boys = Math.max(0, Math.floor(Number(body.boys) || 0));
    const girls = Math.max(0, Math.floor(Number(body.girls) || 0));
    const perTent = Math.floor(Number(body.per_tent) || 8);
    const tokens = Array.isArray(body.neighborhoods) ? body.neighborhoods.slice(0, 7) : [];
    const dryRun = body.dry_run === true;
    if (!groupId) return Response.json({ error: 'group_id is required' }, { status: 400 });
    if (!tokens.length) return Response.json({ error: 'neighborhoods is required' }, { status: 400 });
    if (boys + girls <= 0 || boys + girls > 400) return Response.json({ error: 'boys/girls must total 1-400' }, { status: 400 });
    if (perTent < 1 || perTent > 12) return Response.json({ error: 'per_tent must be 1-12' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    const group = await db.Group.get(groupId).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!group) return Response.json({ error: 'Group not found' }, { status: 404 });
    if (['CANCELLED', 'ARCHIVED'].includes(group.status) || !isGroupOperationallyEnabled(group)) {
      return Response.json({ success: false, error: 'הקבוצה אינה פעילה תפעולית' });
    }

    // Same readiness rule as the לינה screen, so the review link always opens the group's card.
    const [profile] = await db.OperationalGroupProfile.filter({ group_id: groupId });
    if (!profile?.is_sleeping_group || !profile?.sleeping_requirements_completed) {
      return Response.json({ success: false, error: 'יש להשלים קודם את דרישות הלינה של הקבוצה (פרופיל תפעולי) לפני הכנת שיבוץ' });
    }

    const [neighborhoods, tents, periods, drafts, confirmed, nhoodRes] = await Promise.all([
      db.Neighborhood.list(),
      db.Tent.list(),
      db.GroupStayPeriod.filter({ group_id: groupId, status: 'ACTIVE' }),
      db.SleepingAllocation.filter({ status: 'DRAFT' }),
      db.SleepingAllocation.filter({ status: 'CONFIRMED' }),
      db.NeighborhoodReservation.filter({ status: 'ACTIVE' }),
    ]);

    // Nights the plan must be free for.
    const isMulti = group.stay_mode === 'MULTI_PERIOD';
    const windows = isMulti
      ? periods.filter(p => p.end_date > today()).map(p => ({ from: p.start_date, to: p.end_date }))
      : [{ from: group.arrival_date, to: group.departure_date }];
    windows.sort((a, b) => a.from.localeCompare(b.from));
    if (!windows.length || windows.some(w => !w.from || !w.to || w.to <= w.from)) {
      return Response.json({ success: false, error: 'אין לקבוצה תאריכי לינה פעילים' });
    }
    const overlaps = (a) => windows.some(w => sleepingDatesOverlap(w.from, w.to, a.arrival_date, a.departure_date));

    const active = [...drafts, ...confirmed];
    const blockedByOthers = new Set(active.filter(a => a.group_id !== groupId && overlaps(a)).map(a => a.tent_id));
    const ownTents = new Set(active.filter(a => a.group_id === groupId).map(a => a.tent_id)); // preserved, never touched

    const selected = [];
    const warnings = [];
    for (const t of tokens) {
      const n = matchNeighborhood(neighborhoods, t);
      if (!n) warnings.push(`שכונה "${t}" לא נמצאה`);
      else if (n.is_vip) warnings.push(`${n.name} היא שכונת VIP — לא נכללה בשיבוץ חניכים`);
      else if (!selected.some(s => s.id === n.id)) selected.push(n);
    }
    if (!selected.length) return Response.json({ success: false, error: 'לא נמצאו שכונות מתאימות', warnings });

    const sortCode = (a, b) => String(a.code).localeCompare(String(b.code), 'he', { numeric: true });
    const pool = {};
    for (const n of selected) {
      pool[n.id] = tents
        .filter(t => t.neighborhood_id === n.id && t.tent_type !== 'VIP' && (t.working_status || 'WORKING') === 'WORKING')
        .filter(t => !blockedByOthers.has(t.id) && !ownTents.has(t.id))
        .sort(sortCode);
      const others = nhoodRes.filter(r => r.neighborhood_id === n.id && r.group_id !== groupId && overlaps(r));
      if (others.length) warnings.push(`${n.name}: קבוצה אחרת מוזמנת בשכונה בחלק מהתאריכים — יידרש אישור שכונה משותפת בעת האישור`);
    }

    // Gender separation: with 2+ neighborhoods, boys start in the first and girls in the second.
    const order = (startIdx) => [...selected.slice(startIdx), ...selected.slice(0, startIdx)];
    const items = [];
    const place = (gender, count, hoodOrder) => {
      let remaining = count;
      for (const n of hoodOrder) {
        while (remaining > 0 && pool[n.id].length) {
          const tent = pool[n.id].shift();
          const cap = Math.min(perTent, operationalSleepingMaxPax(tent));
          items.push({ tent, n, gender, cap });
          remaining -= cap;
        }
        if (remaining <= 0) break;
      }
      return Math.max(0, remaining);
    };
    const boysLeft = place('BOYS', boys, order(0));
    const girlsLeft = place('GIRLS', girls, order(selected.length > 1 ? 1 : 0));

    // Distribute evenly within each gender's chosen tents, respecting each tent's cap.
    const out = [];
    for (const [gender, total] of [['BOYS', boys], ['GIRLS', girls]]) {
      const list = items.filter(i => i.gender === gender);
      // Round-robin one person at a time → even spread that never exceeds a tent's cap.
      let left = Math.min(total, list.reduce((s, i) => s + i.cap, 0));
      const pax = list.map(() => 0);
      while (left > 0) {
        for (let k = 0; k < list.length && left > 0; k++) {
          if (pax[k] < list[k].cap) { pax[k]++; left--; }
        }
      }
      list.forEach((i, k) => out.push({ tent_id: i.tent.id, tent_code: i.tent.code, neighborhood_id: i.n.id, neighborhood_name: i.n.name, gender_group: gender, allocated_pax: pax[k] }));
    }
    const finalItems = out.filter(r => r.allocated_pax > 0);
    if (boysLeft) warnings.push(`חסרים אוהלים פנויים ל-${boysLeft} בנים בשכונות שנבחרו`);
    if (girlsLeft) warnings.push(`חסרים אוהלים פנויים ל-${girlsLeft} בנות בשכונות שנבחרו`);
    const mixedHoods = selected.filter(n => new Set(finalItems.filter(r => r.neighborhood_id === n.id).map(r => r.gender_group)).size > 1);
    if (mixedHoods.length) warnings.push(`בנים ובנות באותה שכונה (${mixedHoods.map(n => n.name).join(', ')}) — כל אוהל נשאר נפרד מגדרית`);
    if (ownTents.size) warnings.push('שיבוצים קיימים של הקבוצה נשמרים ולא שונו');

    const window_start = windows[0].from;
    const window_end = windows[windows.length - 1].to;
    const summary = {
      group_id: groupId, group_name: group.group_name, stay_mode: group.stay_mode || 'CONTINUOUS',
      window_start, window_end, items: finalItems, warnings,
      boys_placed: finalItems.filter(r => r.gender_group === 'BOYS').reduce((s, r) => s + r.allocated_pax, 0),
      girls_placed: finalItems.filter(r => r.gender_group === 'GIRLS').reduce((s, r) => s + r.allocated_pax, 0),
    };
    if (dryRun || !finalItems.length) return Response.json({ success: finalItems.length > 0, dry_run: dryRun, ...summary });

    const proposal = await db.SleepingAllocationProposal.create({
      group_id: groupId, group_name: group.group_name, instruction: String(body.instruction || '').slice(0, 500),
      stay_mode: summary.stay_mode, window_start, window_end,
      requested_boys: boys, requested_girls: girls,
      items_json: JSON.stringify(finalItems), warnings_json: JSON.stringify(warnings), status: 'PENDING',
    });
    return Response.json({
      success: true, proposal_id: proposal.id,
      review_path: `/allocation?group=${groupId}&proposal=${proposal.id}`,
      ...summary,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}