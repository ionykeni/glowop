import { getOperationalStayDates, isDateInsideStayPeriods } from './groupStayPeriods.js';
import { futureService } from './stayReconciliationActions.js';

// Coffee + Prisa use INCLUSIVE service dates [start_date, end_date] — checkout day is a service day.
export const PRISA_TYPES = ['REGULAR', 'DOUBLE'];
export const PRISA_SLOTS = ['AFTER_BREAKFAST', 'AFTER_LUNCH', 'AFTER_DINNER'];
const live = periods => (periods || []).filter(p => p.status !== 'CANCELLED');
const slimCoffee = r => ({ id: r.id, date: r.date, start_time: r.start_time || null, end_time: r.end_time || null, coffee_corner_type: r.coffee_corner_type || null, location_name_snapshot: r.location_name_snapshot || null, pax: r.pax ?? null });
const slimPrisa = r => ({ id: r.id, date: r.date, type: r.type, quantity: r.quantity, pickup_slot: r.pickup_slot, status: r.status });

export function validPrisaChoice(c) {
  if (!c || !c.date) return false;
  if (c.add === false) return true;
  return c.add === true && PRISA_TYPES.includes(c.type) && Number(c.quantity) > 0 && PRISA_SLOTS.includes(c.pickup_slot);
}

// Pure plan. `coffee` / `prisa` = all group rows, any status. Clock via futureService (Asia/Jerusalem).
export function serviceDecisionPlan({ current, proposed, coffee, prisa, today }) {
  const prop = live(proposed);
  const outside = rows => rows.filter(r => r.status === 'ACTIVE' && r.date >= today && !isDateInsideStayPeriods(r.date, prop));
  const coffeeOut = outside(coffee);
  const prisaOut = outside(prisa);
  const previous = new Set(getOperationalStayDates(live(current)));
  const template = prisa.filter(r => r.status === 'ACTIVE').sort((a, b) => b.date.localeCompare(a.date))[0];
  const added = getOperationalStayDates(prop).filter(d => d >= today && !previous.has(d)).map(date => ({
    date,
    is_checkout: prop.some(p => p.end_date === date),
    is_arrival: prop.some(p => p.start_date === date),
    existing: prisa.filter(r => r.date === date).map(slimPrisa),
  }));
  return {
    required: added.length > 0,
    coffee: {
      cancellations: coffeeOut.filter(futureService).map(slimCoffee),
      preserved_today: coffeeOut.filter(r => !futureService(r)).map(slimCoffee),
    },
    prisa: {
      // No authoritative HH:MM for Prisa: same-day is always preserved.
      cancellations: prisaOut.filter(r => r.date > today).map(slimPrisa),
      preserved_today: prisaOut.filter(r => r.date === today).map(slimPrisa),
      added_dates: added,
      template: template ? { type: template.type, quantity: template.quantity, pickup_slot: template.pickup_slot, source_date: template.date } : null,
    },
  };
}