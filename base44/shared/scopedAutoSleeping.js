import { liveSleeping, overlapSleeping } from './sleepingActionCore.js';
import { validateLinkedSeriesCompleteness } from './logicalSleepingSeries.js';

const student = row => row.allocation_type === 'STUDENT' && !/__(?:vip_req_\d+|alt_tent)__/i.test(row.notes || '');
const maxBeds = tent => Number(tent.capacity || 0);
const keyOf = row => [row.stay_period_id, row.tent_id, row.gender_group, row.allocated_pax, row.arrival_date, row.departure_date].join(':');

export function planScopedAutoSleeping(ctx, editScope) {
  const { group, profile, periods, rows, tents, neighborhoods, reservations, today } = ctx;
  if (group.stay_mode !== 'MULTI_PERIOD') throw new Error('שיבוץ תחום זמין לקבוצה רב־תקופתית בלבד');
  const mine = rows.filter(row => row.group_id === group.id);
  if (!validateLinkedSeriesCompleteness(mine, periods, group.id, today).valid) throw new Error('השיבוץ הקיים אינו עקבי; יש לבדוק אותו לפני שיבוץ אוטומטי');
  const mode = editScope?.mode;
  const selectedIndex = periods.findIndex(p => p.id === editScope?.selected_period_id);
  if (!['ALL', 'SELECTED_ONLY', 'SELECTED_AND_FUTURE'].includes(mode) || (mode !== 'ALL' && selectedIndex < 0)) throw new Error('יש לבחור היקף שיבוץ תקין');
  if (mode !== 'ALL' && periods[selectedIndex].end_date <= today) throw new Error('תקופה שהסתיימה אינה ניתנת לשיבוץ');
  const targets = (mode === 'ALL' ? periods : mode === 'SELECTED_ONLY' ? [periods[selectedIndex]] : periods.slice(selectedIndex)).filter(p => p.end_date > today);
  if (!targets.length) throw new Error('אין תקופות נוכחיות או עתידיות לשיבוץ');
  const boys = Number(profile.boys_beds_needed ?? profile.boys_count ?? 0);
  const girls = Number(profile.girls_beds_needed ?? profile.girls_count ?? 0);
  const required = boys + girls > 0 ? [['BOYS', boys], ['GIRLS', girls]] : [['MIXED', Number(profile.participant_count || profile.total_pax || 0)]];
  const standard = tents.filter(t => t.working_status === 'WORKING' && t.tent_type !== 'VIP' && !neighborhoods.find(n => n.id === t.neighborhood_id)?.is_vip && maxBeds(t) > 0);
  const occupied = rows.filter(liveSleeping);
  const created = [];
  const results = [];
  const preferred = new Set();
  for (const period of targets) {
    const start = period.start_date < today ? today : period.start_date;
    const interval = { arrival_date: start, departure_date: period.end_date };
    // Existing placements (including manual, VIP and alternative tents) always win.
    const existing = mine.filter(r => liveSleeping(r) && overlapSleeping(r, interval));
    const studentRows = existing.filter(student);
    const used = new Set(existing.map(r => r.tent_id));
    const groupHoods = new Set(studentRows.map(r => r.neighborhood_id));
    for (const [gender, needed] of required) {
      const assigned = studentRows.filter(r => r.gender_group === gender).reduce((sum, r) => sum + Number(r.allocated_pax || 0), 0);
      let remaining = Math.max(0, needed - assigned);
      const missing = remaining;
      const proposed = [];
      const candidates = standard.filter(t => !used.has(t.id) && !occupied.some(r => r.tent_id === t.id && overlapSleeping(r, interval)));
      candidates.sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || Number(groupHoods.has(b.neighborhood_id)) - Number(groupHoods.has(a.neighborhood_id)) || String(a.code || '').localeCompare(String(b.code || ''), 'he', { numeric: true }));
      for (const tent of candidates) {
        if (!remaining) break;
        const pax = Math.min(remaining, maxBeds(tent));
        const row = { operational_group_profile_id: profile.id, group_id: group.id, stay_period_id: period.id, tent_id: tent.id, neighborhood_id: tent.neighborhood_id, arrival_date: start, departure_date: period.end_date, segment_start_date: start !== period.start_date ? start : undefined, allocated_pax: pax, allocation_type: 'STUDENT', gender_group: gender, status: 'DRAFT', housekeeping_status: 'PENDING', notes: 'שיבוץ אוטומטי' };
        proposed.push(row); created.push(row); used.add(tent.id); preferred.add(tent.id); groupHoods.add(tent.neighborhood_id); remaining -= pax;
      }
      results.push({ period_id: period.id, start_date: start, end_date: period.end_date, gender, missing, allocated: missing - remaining, remaining, rows: proposed.map(r => ({ tent_id: r.tent_id, neighborhood_id: r.neighborhood_id, pax: r.allocated_pax })) });
    }
  }
  // Link repeated tent/gender/pax combinations as one series. Cancelled future placeholders
  // represent non-use and satisfy the existing lineage validator without inventing past occupancy.
  const byTent = new Map();
  for (const row of created) {
    const key = `${row.tent_id}:${row.gender_group}:${row.allocated_pax}`;
    if (!byTent.has(key)) byTent.set(key, []);
    byTent.get(key).push(row);
  }
  const creates = [];
  for (const seriesRows of byTent.values()) {
    const firstIndex = periods.findIndex(p => p.id === seriesRows[0].stay_period_id);
    const id = crypto.randomUUID();
    for (const period of periods.slice(firstIndex)) {
      const active = seriesRows.find(r => r.stay_period_id === period.id);
      if (active) creates.push({ ...active, allocation_series_id: id, series_effective_from_period_id: periods[firstIndex].id });
      else if (period.end_date > today) creates.push({ ...seriesRows[0], stay_period_id: period.id, arrival_date: period.start_date, departure_date: period.end_date, segment_start_date: undefined, status: 'CANCELLED', series_action: 'RELEASE', series_action_date: period.start_date, allocation_series_id: id, series_effective_from_period_id: periods[firstIndex].id });
    }
  }
  const projected = mine.concat(creates.map((r, i) => ({ ...r, id: `auto-${i}` })));
  if (!validateLinkedSeriesCompleteness(projected, periods, group.id, today).valid) throw new Error('לא ניתן לשמור את רצף השיבוץ המוצע');
  const warnings = [...new Set(created.filter(r => reservations.some(n => n.status === 'ACTIVE' && n.group_id !== group.id && n.neighborhood_id === r.neighborhood_id && overlapSleeping(n, r))).map(r => r.neighborhood_id))];
  return { creates, results, warnings, allocated: results.reduce((s, r) => s + r.allocated, 0), remaining: results.reduce((s, r) => s + r.remaining, 0), proposal_keys: created.map(keyOf).sort() };
}

export const autoProposalKeys = rows => rows.filter(liveSleeping).map(keyOf).sort();