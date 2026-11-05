import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { isLogisticsManagerEmail } from '../../shared/logisticsAssistantData.js';
import { operationalSleepingMaxPax, sleepingDatesOverlap } from '../../shared/sleepingConfirmation.js';
import { isGroupOperationallyEnabled } from '../../shared/groupOperationalIsolation.js';
import { matchNeighborhood, evaluateTentRequests, checkDeclaredTotals } from '../../shared/sleepingProposalValidation.js';

// Prepares a NON-operational sleeping proposal. Never writes SleepingAllocation / NeighborhoodReservation.
// The admin reviews it inside the existing לינה tab and saves through the existing confirm/commit path.
// Two modes:
//  - EXPLICIT (body.tents): the exact requested tents. Each tent gets a status; nothing is replaced or redistributed.
//  - AUTO (body.neighborhoods + boys/girls): picks free tents, and reports every unplaced student / unused neighborhood.

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

const sumPax = (list, key = 'allocated_pax') => list.reduce((s, r) => s + (Number(r[key]) || 0), 0);

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isLogisticsManagerEmail(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const groupId = String(body.group_id || '').trim();
    const explicit = Array.isArray(body.tents) && body.tents.length > 0;
    const tentRequests = explicit ? body.tents.slice(0, 120) : [];
    const boys = Math.max(0, Math.floor(Number(body.boys) || 0));
    const girls = Math.max(0, Math.floor(Number(body.girls) || 0));
    const perTent = Math.floor(Number(body.per_tent) || 8);
    const tokens = Array.isArray(body.neighborhoods) ? body.neighborhoods.slice(0, 7) : [];
    const dryRun = body.dry_run === true;
    // Isolated simulation only: evaluate as if the group had no sleeping rows yet. Never persists.
    const ignoreOwn = dryRun && body.dry_run_ignore_group_allocations === true;
    if (!groupId) return Response.json({ error: 'group_id is required' }, { status: 400 });
    if (!explicit) {
      if (!tokens.length) return Response.json({ error: 'neighborhoods or tents is required' }, { status: 400 });
      if (boys + girls <= 0 || boys + girls > 400) return Response.json({ error: 'boys/girls must total 1-400' }, { status: 400 });
      if (perTent < 1 || perTent > 12) return Response.json({ error: 'per_tent must be 1-12' }, { status: 400 });
    }

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
    const now = today();
    const isMulti = group.stay_mode === 'MULTI_PERIOD';
    const windows = isMulti
      ? periods.filter(p => p.end_date > now).map(p => ({ from: p.start_date, to: p.end_date }))
      : [{ from: group.arrival_date, to: group.departure_date }];
    windows.sort((a, b) => a.from.localeCompare(b.from));
    if (!windows.length || windows.some(w => !w.from || !w.to || w.to <= w.from)) {
      return Response.json({ success: false, error: 'אין לקבוצה תאריכי לינה פעילים' });
    }
    const overlaps = (a) => windows.some(w => sleepingDatesOverlap(w.from, w.to, a.arrival_date, a.departure_date));

    const active = [...drafts, ...confirmed].filter(a => !(ignoreOwn && a.group_id === groupId));
    const otherIds = [...new Set(active.filter(a => a.group_id !== groupId && overlaps(a)).map(a => a.group_id))];
    const otherGroups = otherIds.length ? await db.Group.filter({ id: { $in: otherIds } }) : [];
    const groupNames = Object.fromEntries(otherGroups.map(g => [g.id, g.group_name]));

    let finalItems = [];
    let missing = [];
    let alreadyAllocated = [];
    const issues = [];
    const warnings = [];
    let requestedBoys = boys;
    let requestedGirls = girls;
    let requestedTents = null;

    if (explicit) {
      const evaluated = evaluateTentRequests(tentRequests, {
        tents, neighborhoods, allocs: active, groupId, groupNames, windows, today: now, overlaps, maxPax: operationalSleepingMaxPax,
      });
      issues.push(...checkDeclaredTotals(body.expected, evaluated, neighborhoods, tokens));
      finalItems = evaluated.filter(r => r.status === 'OK').map(r => ({
        tent_id: r.tent_id, tent_code: r.tent_code, neighborhood_id: r.neighborhood_id, neighborhood_name: r.neighborhood_name,
        gender_group: r.gender_group, allocated_pax: r.allocated_pax,
      }));
      alreadyAllocated = evaluated.filter(r => r.status === 'ALREADY_ALLOCATED');
      missing = evaluated.filter(r => !['OK', 'ALREADY_ALLOCATED'].includes(r.status));
      requestedBoys = sumPax(evaluated.filter(r => r.gender_group === 'BOYS'), 'pax');
      requestedGirls = sumPax(evaluated.filter(r => r.gender_group === 'GIRLS'), 'pax');
      requestedTents = evaluated.length;
    } else {
      const blockedByOthers = new Set(active.filter(a => a.group_id !== groupId && overlaps(a)).map(a => a.tent_id));
      const ownActive = active.filter(a => a.group_id === groupId && overlaps(a));
      const ownTents = new Set(ownActive.map(a => a.tent_id)); // preserved, never touched

      const selected = [];
      for (const t of tokens) {
        const n = matchNeighborhood(neighborhoods, t);
        if (!n) issues.push(`שכונה "${t}" לא נמצאה`);
        else if (n.is_vip) issues.push(`${n.name} היא שכונת VIP — לא נכללה בשיבוץ חניכים`);
        else if (!selected.some(s => s.id === n.id)) selected.push(n);
      }
      if (!selected.length) return Response.json({ success: false, completeness: 'INCOMPLETE', error: 'לא נמצאו שכונות מתאימות', issues });

      const sortCode = (a, b) => String(a.code).localeCompare(String(b.code), 'he', { numeric: true });
      const pool = {};
      const ownByHood = {};
      for (const n of selected) {
        pool[n.id] = tents
          .filter(t => t.neighborhood_id === n.id && t.tent_type !== 'VIP' && (t.working_status || 'WORKING') === 'WORKING')
          .filter(t => !blockedByOthers.has(t.id) && !ownTents.has(t.id))
          .sort(sortCode);
        ownByHood[n.id] = ownActive.filter(a => a.neighborhood_id === n.id);
      }

      // Gender separation: with 2+ neighborhoods, boys start in the first and girls in the second.
      const order = (startIdx) => [...selected.slice(startIdx), ...selected.slice(0, startIdx)];
      const picked = [];
      const place = (gender, count, hoodOrder) => {
        let remaining = count;
        for (const n of hoodOrder) {
          while (remaining > 0 && pool[n.id].length) {
            const tent = pool[n.id].shift();
            const cap = Math.min(perTent, operationalSleepingMaxPax(tent));
            picked.push({ tent, n, gender, cap });
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
        const list = picked.filter(i => i.gender === gender);
        let left = Math.min(total, list.reduce((s, i) => s + i.cap, 0));
        const pax = list.map(() => 0);
        while (left > 0) {
          for (let k = 0; k < list.length && left > 0; k++) {
            if (pax[k] < list[k].cap) { pax[k]++; left--; }
          }
        }
        list.forEach((i, k) => out.push({ tent_id: i.tent.id, tent_code: i.tent.code, neighborhood_id: i.n.id, neighborhood_name: i.n.name, gender_group: gender, allocated_pax: pax[k] }));
      }
      finalItems = out.filter(r => r.allocated_pax > 0);
      if (boysLeft) missing.push({ status: 'NO_FREE_TENTS', gender_group: 'BOYS', pax: boysLeft, reason: `חסרים אוהלים פנויים ל-${boysLeft} בנים בשכונות שנבחרו` });
      if (girlsLeft) missing.push({ status: 'NO_FREE_TENTS', gender_group: 'GIRLS', pax: girlsLeft, reason: `חסרים אוהלים פנויים ל-${girlsLeft} בנות בשכונות שנבחרו` });
      for (const n of selected) {
        if (finalItems.some(r => r.neighborhood_id === n.id)) continue;
        const own = ownByHood[n.id];
        issues.push(own.length
          ? `${n.name}: כל האוהלים הפנויים כבר משובצים לקבוצה (${new Set(own.map(a => a.tent_id)).size} אוהלים, ${sumPax(own)} חניכים) — לא נוספו אוהלים`
          : pool[n.id].length ? `${n.name}: לא נדרשו אוהלים מהשכונה כדי לכסות את הכמות שהתבקשה` : `${n.name}: אין אוהלים פנויים בתאריכים`);
      }
      if (ownActive.length) warnings.push(`לקבוצה כבר יש ${ownTents.size} אוהלים משובצים (${sumPax(ownActive)} חניכים) — הם נשמרים ולא שונו`);
      const mixedHoods = selected.filter(n => new Set(finalItems.filter(r => r.neighborhood_id === n.id).map(r => r.gender_group)).size > 1);
      if (mixedHoods.length) warnings.push(`בנים ובנות באותה שכונה (${mixedHoods.map(n => n.name).join(', ')}) — כל אוהל נשאר נפרד מגדרית`);
    }

    // Shared-neighborhood warnings are NOT blockers — they go through the existing approval at confirm time.
    const hoodIds = [...new Set(finalItems.map(r => r.neighborhood_id))];
    const shared_neighborhood_warnings = hoodIds.flatMap(hid => {
      const others = nhoodRes.filter(r => r.neighborhood_id === hid && r.group_id !== groupId && overlaps(r));
      if (!others.length) return [];
      const name = neighborhoods.find(n => n.id === hid)?.name || hid;
      return [{ neighborhood_id: hid, neighborhood_name: name, message: `${name}: קבוצה אחרת מוזמנת בשכונה בחלק מהתאריכים — יידרש אישור שכונה משותפת בעת האישור` }];
    });

    const completeness = !missing.length && !issues.length
      ? (finalItems.length ? 'COMPLETE' : 'ALREADY_ALLOCATED')
      : 'INCOMPLETE';
    const totals = {
      requested_tents: requestedTents,
      requested_students: requestedBoys + requestedGirls,
      requested_boys: requestedBoys,
      requested_girls: requestedGirls,
      proposed_tents: finalItems.length,
      proposed_students: sumPax(finalItems),
      already_allocated_tents: alreadyAllocated.length,
      already_allocated_students: sumPax(alreadyAllocated, 'pax'),
      missing_tents: explicit ? missing.length : null,
      missing_students: sumPax(missing, 'pax'),
    };
    const missingOut = missing.map(m => ({
      tent_code: m.tent_code || null, neighborhood: m.neighborhood_name || m.requested_neighborhood || null,
      gender_group: m.gender_group || null, pax: m.pax || 0, status: m.status, reason: m.reason, blocked_by: m.blocked_by || undefined,
    }));
    const summary = {
      group_id: groupId, group_name: group.group_name, stay_mode: group.stay_mode || 'CONTINUOUS',
      window_start: windows[0].from, window_end: windows[windows.length - 1].to,
      mode: explicit ? 'EXPLICIT' : 'AUTO', completeness, totals,
      items: finalItems, missing: missingOut, issues,
      already_allocated: alreadyAllocated.map(r => ({ tent_code: r.tent_code, neighborhood: r.neighborhood_name, gender_group: r.gender_group, pax: r.pax })),
      shared_neighborhood_warnings, warnings,
    };

    if (dryRun || !finalItems.length) {
      return Response.json({ success: finalItems.length > 0 || completeness === 'ALREADY_ALLOCATED', dry_run: dryRun, simulation_ignored_group_allocations: ignoreOwn, ...summary });
    }

    const allWarnings = [
      ...(completeness === 'INCOMPLETE' ? ['הצעה חלקית — לא כל הבקשה נכללה. ראה פירוט החוסרים.'] : []),
      ...issues, ...missingOut.map(m => m.reason), ...shared_neighborhood_warnings.map(s => s.message), ...warnings,
    ];
    const proposal = await db.SleepingAllocationProposal.create({
      group_id: groupId, group_name: group.group_name, instruction: String(body.instruction || '').slice(0, 1000),
      stay_mode: summary.stay_mode, window_start: summary.window_start, window_end: summary.window_end,
      requested_boys: requestedBoys, requested_girls: requestedGirls,
      items_json: JSON.stringify(finalItems), warnings_json: JSON.stringify(allWarnings),
      completeness, missing_json: JSON.stringify(missingOut), request_json: JSON.stringify(explicit ? { tents: tentRequests, expected: body.expected || null } : { neighborhoods: tokens, boys, girls, per_tent: perTent }),
      status: 'PENDING',
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