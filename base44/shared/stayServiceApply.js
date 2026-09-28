import { readAll, todayIL } from './stayReconciliationCore.js';
import { performItemAction, persistImpact, resolveItem } from './stayReconciliationActions.js';
import { serviceDecisionPlan, validPrisaChoice } from './stayServiceDecisions.js';

const SUMMARY = { COFFEE: 'פינת קפה מחוץ לתקופת השהייה החדשה', PRISA: 'פריסה מחוץ לתקופת השהייה החדשה' };
const outsideImpact = (module, entity, r) => ({ key: `${module}:OUTSIDE_STAY:${r.date}:${r.id}`, module, impact_type: 'OUTSIDE_STAY', date: r.date, summary: SUMMARY[module], metadata: { entity, record_id: r.id }, action: 'CANCEL' });

// Coffee + Prisa consequences of a stay change. Fresh server-side recompute; idempotent on retry.
export async function applyStayServiceDecisions(db, change, plan, decisions, email) {
  const failures = [];
  const step = async fn => { try { await fn(); } catch (error) { failures.push(error.message); } };
  const [periods, coffee, prisa, profiles] = await Promise.all([
    readAll(db.GroupStayPeriod, { group_id: change.group_id, status: 'ACTIVE' }),
    readAll(db.CoffeeCornerRequest, { group_id: change.group_id }),
    readAll(db.PrisaRequest, { group_id: change.group_id }),
    db.OperationalGroupProfile.filter({ group_id: change.group_id }),
  ]);
  const fresh = serviceDecisionPlan({ current: plan.currentPeriods, proposed: periods, coffee, prisa, today: todayIL() });

  for (const [module, entity, part] of [['COFFEE', 'CoffeeCornerRequest', fresh.coffee], ['PRISA', 'PrisaRequest', fresh.prisa]]) {
    for (const r of part.cancellations) await step(async () => {
      const task = await persistImpact(db, change, outsideImpact(module, entity, r), email);
      await performItemAction(db, task, email, 'CANCEL');
    });
    for (const r of part.preserved_today) await step(async () => {
      const task = await persistImpact(db, change, outsideImpact(module, entity, r), email);
      if (task.status === 'OPEN') await resolveItem(db, task, email, 'נשמרה — שירות של היום אינו מבוטל אוטומטית');
    });
  }

  const byDate = new Map((Array.isArray(decisions) ? decisions : []).filter(validPrisaChoice).map(d => [d.date, d]));
  const profile = profiles.length === 1 ? profiles[0] : null;
  for (const day of fresh.prisa.added_dates) await step(async () => {
    const task = await persistImpact(db, change, { key: `PRISA:DAY_DECISION:${day.date}`, module: 'PRISA', impact_type: 'DAY_DECISION', date: day.date, summary: `${day.is_checkout ? 'יום עזיבה' : 'יום שהייה'} חדש — נדרשת החלטת פריסה`, metadata: {}, action: null }, email);
    if (task.status === 'RESOLVED') return;
    const choice = byDate.get(day.date);
    if (!choice) return;
    if (!choice.add) { await resolveItem(db, task, email, 'החלטת מנהל: לא נדרשת פריסה'); return; }
    const quantity = Number(choice.quantity);
    const rows = prisa.filter(r => r.date === day.date);
    if (rows.some(r => r.status === 'ACTIVE' && r.type === choice.type && r.pickup_slot === choice.pickup_slot && Number(r.quantity) === quantity)) {
      await resolveItem(db, task, email, 'פריסה תואמת כבר קיימת בתאריך'); return;
    }
    if (rows.length || !profile) {
      await persistImpact(db, change, { key: `PRISA:MANUAL_REVIEW:${day.date}`, module: 'PRISA', impact_type: 'MANUAL_REVIEW', date: day.date, summary: rows.length ? 'קיימת פריסה אחרת/מבוטלת בתאריך — נדרשת בדיקה ידנית' : 'חסר פרופיל קבוצה — לא נוספה פריסה', metadata: { requested: { type: choice.type, quantity, pickup_slot: choice.pickup_slot } }, action: null }, email);
      await resolveItem(db, task, email, 'הועבר לבדיקה ידנית'); return;
    }
    await db.PrisaRequest.create({
      group_id: change.group_id, operational_group_profile_id: profile.id, date: day.date,
      quantity, type: choice.type, pickup_slot: choice.pickup_slot,
      effective_quantity: choice.type === 'DOUBLE' ? quantity * 2 : quantity,
      notes: `נוסף בעקבות שינוי תקופת שהייה (${change.id})`, source: 'MANUAL', status: 'ACTIVE',
    });
    await resolveItem(db, task, email, 'החלטת מנהל: נוספה פריסה');
  });

  if (failures.length) throw new Error(`קפה/פריסה: ${failures.join(' · ')}`);
}