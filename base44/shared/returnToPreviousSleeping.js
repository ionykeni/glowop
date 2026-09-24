import { liveSleeping, overlapSleeping } from './sleepingActionCore.js';
import { missingSleepingNights } from './sleepingCoverage.js';

const mark = row => String(row.notes || '').match(/__vip_req_\d+__|__alt_tent__/i)?.[0] || '';
const key = row => [row.stay_period_id,row.tent_id,row.arrival_date,row.departure_date,row.allocated_pax,row.gender_group,mark(row)].join(':');

export function planReturnToPreviousSleeping(ctx, periodId) {
  const { group, profile, periods, rows, tents, reservations, today } = ctx;
  const index = periods.findIndex(p => p.id === periodId);
  if (index < 1 || periods[index].end_date <= today) throw new Error('אין תקופה נוכחית/עתידית עם תקופה קודמת');
  const period = periods[index], previous = periods[index - 1];
  // Sample the last actual sleeping night, not the group's current allocation or cancelled attempts.
  const lastNight = new Date(`${previous.end_date}T12:00:00Z`);
  lastNight.setUTCDate(lastNight.getUTCDate() - 1);
  const date = lastNight.toISOString().slice(0, 10);
  const snapshot = rows.filter(r => r.group_id === group.id && r.stay_period_id === previous.id && r.status === 'CONFIRMED' && (r.segment_start_date || r.arrival_date) <= date && date < (r.segment_end_date || r.departure_date));
  if (!snapshot.length || new Set(snapshot.map(r => r.tent_id)).size !== snapshot.length || snapshot.some(r => !r.tent_id || !Number.isFinite(Number(r.allocated_pax)) || Number(r.allocated_pax) < 1)) throw new Error('לא נמצא שיבוץ היסטורי מאושר ותקין בתקופה הקודמת');
  const missing = missingSleepingNights(period, rows.filter(r => r.group_id === group.id), profile, today);
  if (!missing.length) throw new Error('אין לילות חסרים לשיבוץ בתקופה שנבחרה');
  const start = missing[0];
  const creates = snapshot.map(source => {
    const matching = rows.filter(r => r.group_id === group.id && r.stay_period_id === period.id && r.status === 'CONFIRMED' && r.tent_id === source.tent_id && r.gender_group === source.gender_group && mark(r) === mark(source) && Number(r.allocated_pax) === Number(source.allocated_pax) && r.departure_date > start).sort((a,b) => a.arrival_date.localeCompare(b.arrival_date));
    const end = matching[0]?.arrival_date < period.end_date ? matching[0].arrival_date : period.end_date;
    const tent = tents.find(t => t.id === source.tent_id);
    return { operational_group_profile_id: profile.id, group_id: group.id, stay_period_id: period.id, allocation_series_id: crypto.randomUUID(), series_effective_from_period_id: period.id, source_allocation_id: source.id, tent_id: source.tent_id, neighborhood_id: source.neighborhood_id, allocated_pax: Number(source.allocated_pax), allocation_type: source.allocation_type, gender_group: source.gender_group, notes: source.notes || '', arrival_date: start, departure_date: end, segment_start_date: start !== period.start_date ? start : undefined, status: 'DRAFT', housekeeping_status: 'PENDING', tent_code: tent?.code };
  });
  if (creates.some(r => r.arrival_date >= r.departure_date)) throw new Error('השיבוץ הקודם כבר קיים בתקופה זו; יש להשלים את השיבוץ ידנית');
  const blocked = creates.flatMap(r => {
    const tent = tents.find(t => t.id === r.tent_id);
    const capacity = tent?.tent_type === 'VIP' || tent?.is_accessible ? Math.max(Number(tent?.capacity || 0), 4) : Number(tent?.capacity || 0);
    const unavailable = !tent || tent.working_status !== 'WORKING' || tent.neighborhood_id !== r.neighborhood_id || r.allocated_pax > capacity;
    const conflict = rows.some(other => liveSleeping(other) && other.tent_id === r.tent_id && overlapSleeping(r, other));
    return unavailable || conflict ? [r.tent_code || r.tent_id] : [];
  });
  const warnings = [...new Set(creates.filter(r => reservations.some(n => n.group_id !== group.id && n.neighborhood_id === r.neighborhood_id && n.status === 'ACTIVE' && overlapSleeping(n,r))).map(r => r.neighborhood_id))];
  return { creates, blocked: [...new Set(blocked)], warnings, proposal_keys: creates.map(key).sort(), source_period: { start_date: previous.start_date, end_date: previous.end_date }, target_period: { start_date: start, end_date: period.end_date } };
}