// Pure validation helpers for assistant sleeping proposals (no I/O).
// Every requested tent gets an explicit status — nothing is ever dropped silently.

export function matchNeighborhood(neighborhoods, token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, '');
  return neighborhoods.find(n => n.id === t)
    || neighborhoods.find(n => String(n.code || '').toLowerCase() === t.toLowerCase())
    || neighborhoods.find(n => n.name === t)
    || (digits ? neighborhoods.find(n => String(n.code || '').replace(/\D/g, '') === digits || String(n.name || '').replace(/\D/g, '') === digits) : null)
    || null;
}

const GENDER_MAP = { BOYS: 'BOYS', GIRLS: 'GIRLS', 'בנים': 'BOYS', 'בן': 'BOYS', 'בנות': 'GIRLS', 'בת': 'GIRLS' };
export const normGender = (g) => GENDER_MAP[String(g || '').trim().toUpperCase()] || GENDER_MAP[String(g || '').trim()] || null;
export const normCode = (c) => String(c || '').replace(/[\s'"׳״]/g, '');
const genderLabel = (g) => (g === 'GIRLS' ? 'בנות' : g === 'BOYS' ? 'בנים' : 'מעורב');

/**
 * ctx: { tents, neighborhoods, allocs (active DRAFT+CONFIRMED rows of all groups), groupId, groupNames,
 *        windows [{from,to}], today, overlaps(a), maxPax(tent) }
 */
export function evaluateTentRequests(requests, ctx) {
  const seen = new Set();
  return requests.map((r, index) => {
    const code = normCode(r.tent_code);
    const gender = normGender(r.gender_group);
    const pax = Math.floor(Number(r.pax));
    const hood = r.neighborhood ? matchNeighborhood(ctx.neighborhoods, r.neighborhood) : null;
    const base = { index, tent_code: code, requested_neighborhood: r.neighborhood ? String(r.neighborhood) : null, gender_group: gender, pax: Number.isFinite(pax) ? pax : 0 };
    const fail = (status, reason, extra = {}) => ({ ...base, status, reason, ...extra });

    if (!code) return fail('INVALID', 'חסר מספר אוהל');
    if (!gender) return fail('INVALID', `אוהל ${code}: לא צוין בנים/בנות`);
    if (!(pax >= 1)) return fail('INVALID', `אוהל ${code}: מספר חניכים לא תקין`);
    if (r.neighborhood && !hood) return fail('NOT_FOUND', `שכונה "${r.neighborhood}" לא נמצאה`);
    const candidates = ctx.tents.filter(t => normCode(t.code) === code && (!hood || t.neighborhood_id === hood.id));
    if (candidates.length !== 1) {
      return fail('NOT_FOUND', candidates.length
        ? `אוהל ${code} קיים ביותר משכונה אחת — יש לציין שכונה`
        : `אוהל ${code} לא נמצא${hood ? ` ב${hood.name}` : ''}`);
    }

    const tent = candidates[0];
    const n = ctx.neighborhoods.find(x => x.id === tent.neighborhood_id);
    const located = { ...base, tent_id: tent.id, tent_code: tent.code, neighborhood_id: tent.neighborhood_id, neighborhood_name: n?.name || null };
    const bad = (status, reason, extra = {}) => ({ ...located, status, reason, ...extra });

    if (seen.has(tent.id)) return bad('DUPLICATE_IN_REQUEST', `אוהל ${tent.code} מופיע יותר מפעם אחת בבקשה`);
    seen.add(tent.id);
    if (n?.is_vip || tent.tent_type === 'VIP') return bad('UNAVAILABLE', `אוהל ${tent.code} הוא אוהל VIP ואינו לשיבוץ חניכים`);
    if ((tent.working_status || 'WORKING') !== 'WORKING') return bad('UNAVAILABLE', `אוהל ${tent.code} אינו זמין (${tent.working_status})`);
    const cap = ctx.maxPax(tent);
    if (pax > cap) return bad('OVER_CAPACITY', `אוהל ${tent.code}: התבקשו ${pax} אך הקיבולת היא ${cap}`);

    const hits = ctx.allocs.filter(a => a.tent_id === tent.id && ctx.overlaps(a));
    const others = hits.filter(a => a.group_id !== ctx.groupId);
    if (others.length) {
      const blocked_by = others.map(a => ({
        group_id: a.group_id, group_name: ctx.groupNames[a.group_id] || null, status: a.status,
        nights_from: a.arrival_date, checkout: a.departure_date,
      }));
      const who = blocked_by.map(b => `${b.group_name || 'קבוצה אחרת'} (${b.status === 'DRAFT' ? 'טיוטה' : 'מאושר'}, ${b.nights_from} עד ${b.checkout})`).join('; ');
      return bad('TENT_CONFLICT', `אוהל ${tent.code} תפוס באותם תאריכים ע״י ${who}`, { blocked_by });
    }

    const own = hits.filter(a => a.group_id === ctx.groupId);
    if (own.length) {
      const covered = ctx.windows.every(w => {
        const from = w.from > ctx.today ? w.from : ctx.today;
        return own.some(a => a.arrival_date <= from && a.departure_date >= w.to);
      });
      const same = own.every(a => a.gender_group === gender && Number(a.allocated_pax) === pax);
      const existing = own.map(a => ({ gender_group: a.gender_group, allocated_pax: a.allocated_pax, status: a.status, nights_from: a.arrival_date, checkout: a.departure_date }));
      if (same && covered) return bad('ALREADY_ALLOCATED', `אוהל ${tent.code} כבר משובץ לקבוצה כמבוקש`, { existing });
      const reason = !covered
        ? `אוהל ${tent.code} משובץ לקבוצה רק בחלק מהתאריכים — יש להשלים במסך הלינה`
        : `אוהל ${tent.code} כבר משובץ לקבוצה עם ${genderLabel(own[0].gender_group)} ${own[0].allocated_pax} — שינוי נעשה במסך הלינה`;
      return bad('ALREADY_ALLOCATED_DIFFERENT', reason, { existing });
    }

    return { ...located, status: 'OK', allocated_pax: pax };
  });
}

// Compares the evaluated list with the totals the admin declared, so a dropped tent or neighborhood is caught.
export function checkDeclaredTotals(expected, evaluated, neighborhoods, requestedHoods = []) {
  const issues = [];
  const pax = (list) => list.reduce((s, r) => s + (Number(r.pax) || 0), 0);
  const e = expected || {};
  const cmp = (declared, actual, label) => {
    if (declared != null && declared !== '' && Number(declared) !== actual) issues.push(`${label}: בבקשה ${declared}, ברשימת האוהלים ${actual}`);
  };
  cmp(e.total_tents, evaluated.length, 'מספר אוהלים');
  cmp(e.total_students, pax(evaluated), 'מספר חניכים');
  cmp(e.boys, pax(evaluated.filter(r => r.gender_group === 'BOYS')), 'בנים');
  cmp(e.girls, pax(evaluated.filter(r => r.gender_group === 'GIRLS')), 'בנות');

  const hoodOf = (r) => r.neighborhood_id || matchNeighborhood(neighborhoods, r.requested_neighborhood)?.id || null;
  for (const b of Array.isArray(e.by_neighborhood) ? e.by_neighborhood : []) {
    const n = matchNeighborhood(neighborhoods, b.neighborhood);
    if (!n) { issues.push(`שכונה "${b.neighborhood}" מהסיכום לא נמצאה`); continue; }
    const list = evaluated.filter(r => hoodOf(r) === n.id);
    cmp(b.tents, list.length, `${n.name} — אוהלים`);
    cmp(b.students, pax(list), `${n.name} — חניכים`);
  }
  for (const token of requestedHoods) {
    const n = matchNeighborhood(neighborhoods, token);
    if (!n) issues.push(`שכונה "${token}" לא נמצאה`);
    else if (!evaluated.some(r => hoodOf(r) === n.id)) issues.push(`${n.name} התבקשה אך אין לה אוהלים ברשימה`);
  }
  return issues;
}