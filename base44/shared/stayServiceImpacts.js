import { getOperationalStayDates, isDateInsideStayPeriods } from './groupStayPeriods.js';
import { mealExtensionImpacts } from './stayMealPattern.js';
export function serviceImpacts({ current, proposed, meals, scheduleItems, coffeeRequests, prisaRequests, today }) {
  const impacts = [];
  const labels = { MEALS: 'ארוחה', ACTIVITIES: 'פעילות', COFFEE: 'פינת קפה', PRISA: 'פריסה' };
  for (const [module, rows, entity] of [['MEALS',meals,'MealReservation'],['ACTIVITIES',scheduleItems,'GroupScheduleItem'],['COFFEE',coffeeRequests,'CoffeeCornerRequest'],['PRISA',prisaRequests,'PrisaRequest']]) {
    for (const row of rows.filter(r => r.date >= today && !isDateInsideStayPeriods(r.date,proposed))) {
      impacts.push({ module, impact_type: 'OUTSIDE_STAY', date: row.date, summary: `${labels[module]} מחוץ לתקופת השהייה החדשה${row.activity_name ? ` — ${row.activity_name}` : ''}`, metadata: { entity, record_id: row.id, meal_type: row.meal_type || null }, action: ['MEALS','PRISA'].includes(module) ? 'CANCEL' : null });
    }
  }
  impacts.push(...mealExtensionImpacts(meals,current,proposed,today));
  const previous = new Set(getOperationalStayDates(current));
  for (const date of getOperationalStayDates(proposed).filter(d => d >= today && !previous.has(d))) {
    for (const [module,rows] of [['ACTIVITIES',scheduleItems],['COFFEE',coffeeRequests],['PRISA',prisaRequests]]) {
      impacts.push({ module, impact_type:'ADDED_DATE', date, summary: `${labels[module]} — בדיקת צורך ביום השהייה הנוסף (${rows.filter(r => r.date === date).length} רשומות קיימות)`, metadata: {}, action: null });
    }
  }
  return impacts;
}