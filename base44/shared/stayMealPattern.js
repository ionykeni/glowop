import { getOperationalStayDates } from './groupStayPeriods.js';
import { pick } from './stayReconciliationCore.js';
const TYPES = ['BREAKFAST','LUNCH','DINNER'];
const FIELDS = ['meal_type','start_time','end_time','pax','pax_sync_locked','special_diets_summary','sandwich_option','notes'];
// Require at least two complete INTERIOR days, identical in every copied attribute.
// Boundary days are never inferred from a full-day pattern.
export function mealPattern(meals, periods) {
  const days = getOperationalStayDates(periods).filter(d => periods.some(p => p.start_date < d && d < p.end_date));
  const patterns = days.map(date => meals.filter(m => m.date === date && m.status === 'ACTIVE'));
  const used = patterns.filter(rows => rows.length);
  if (used.length < 2 || used.length !== patterns.length) return null;
  const normalize = rows => rows.slice().sort((a,b) => a.meal_type.localeCompare(b.meal_type)).map(r => pick(r, FIELDS));
  if (used.some(rows => rows.length !== 3 || TYPES.some(type => rows.filter(r => r.meal_type === type).length !== 1) || rows.some(r => !r.start_time || !r.end_time || !Number.isFinite(Number(r.pax)) || Number(r.pax) <= 0))) return null;
  const pattern = normalize(used[0]);
  return used.every(rows => JSON.stringify(normalize(rows)) === JSON.stringify(pattern)) ? pattern : null;
}
export function mealExtensionImpacts(meals, current, proposed, today) {
  const oldDates = new Set(getOperationalStayDates(current));
  // Includes an old checkout that becomes an interior day, not just wholly new dates.
  const changedDates = getOperationalStayDates(proposed).filter(d => d >= today && (!oldDates.has(d) || current.some(p => p.end_date === d) && proposed.some(p => p.start_date < d && d < p.end_date)));
  const pattern = mealPattern(meals, current);
  return changedDates.map(date => {
    const interior = proposed.some(p => p.start_date < date && date < p.end_date);
    const existing = meals.filter(m => m.date === date && m.status === 'ACTIVE');
    const templates = pattern && interior ? pattern.filter(t => !existing.some(m => m.meal_type === t.meal_type)) : [];
    return { module: 'MEALS', impact_type: 'ADDED_DATE', date, summary: templates.length ? `${templates.length} ארוחות חסרות — ניתן להוסיף לפי הדפוס הקיים` : 'יום שהייה נוסף — נדרשת בדיקת ארוחות ושעות הגעה/עזיבה', metadata: { templates, existing_count: existing.length }, action: templates.length ? 'ADD_MEALS' : null };
  });
}