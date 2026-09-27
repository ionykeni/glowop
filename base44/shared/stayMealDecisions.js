import { getOperationalStayDates, isDateInsideStayPeriods } from './groupStayPeriods.js';
import { futureService } from './stayReconciliationActions.js';
import { mealPattern } from './stayMealPattern.js';
import { MEAL_DEFAULTS } from './mealDefaults.js';

// Meals use inclusive operational dates [start,end]; sleeping stays [start,end) elsewhere.
export const DAY_MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'];
// Same marker written by the existing CANCEL executor in stayReconciliationActions.js.
export const STAY_CANCEL_MARK = 'בוטל בעקבות שינוי תקופת שהייה';

const livePeriods = periods => (periods || []).filter(p => p.status !== 'CANCELLED');
const slim = m => ({ id: m.id, date: m.date, meal_type: m.meal_type, start_time: m.start_time || null });
const isStayCancelled = r => r.status === 'CANCELLED' && String(r.notes || '').includes(STAY_CANCEL_MARK);

export function mealTimes(type, pattern) {
  const template = pattern?.find(t => t.meal_type === type);
  return {
    start_time: template?.start_time || MEAL_DEFAULTS[type].start_time,
    end_time: template?.end_time || MEAL_DEFAULTS[type].end_time,
    template: template || null,
  };
}

// Pure plan (clock only via futureService, Asia/Jerusalem). `meals` = all group meals, any status.
export function mealDecisionPlan({ current, proposed, meals, today }) {
  const cur = livePeriods(current), prop = livePeriods(proposed);
  const live = meals.filter(m => m.status === 'ACTIVE');
  const outside = live.filter(m => m.date >= today && !isDateInsideStayPeriods(m.date, prop));
  const interior = d => prop.some(p => p.start_date < d && d < p.end_date);
  const oldDates = new Set(getOperationalStayDates(cur));
  // Same "changed date" rule as mealExtensionImpacts, plus every new/changed checkout date.
  const changed = getOperationalStayDates(prop).filter(d => d >= today && (!oldDates.has(d) || cur.some(p => p.end_date === d) && interior(d)));
  const checkouts = prop.map(p => p.end_date).filter(d => d >= today && !cur.some(p => p.end_date === d));
  const pattern = mealPattern(live, cur);
  const dates = [...new Set([...changed, ...checkouts])].sort().map(date => {
    const rows = meals.filter(m => m.date === date && DAY_MEAL_TYPES.includes(m.meal_type));
    const types = fn => DAY_MEAL_TYPES.filter(t => fn(rows.filter(r => r.meal_type === t)));
    const hasActive = rs => rs.some(r => r.status === 'ACTIVE');
    return {
      date,
      is_checkout: prop.some(p => p.end_date === date),
      is_arrival: prop.some(p => p.start_date === date),
      existing_active: types(hasActive),
      reactivatable: types(rs => !hasActive(rs) && rs.some(isStayCancelled)),
      needs_review: types(rs => !hasActive(rs) && rs.some(r => r.status === 'CANCELLED') && !rs.some(isStayCancelled)),
      elapsed: DAY_MEAL_TYPES.filter(t => !futureService({ date, start_time: mealTimes(t, pattern).start_time })),
      suggestion: pattern && interior(date) ? pattern.map(t => t.meal_type) : null,
    };
  });
  return {
    required: dates.length > 0,
    cancellations: outside.filter(futureService).map(slim),
    preserved_today: outside.filter(m => !futureService(m)).map(slim),
    dates,
    pattern,
  };
}