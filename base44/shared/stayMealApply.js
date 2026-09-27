import { readAll, todayIL } from './stayReconciliationCore.js';
import { futureService, performItemAction, persistImpact, resolveItem } from './stayReconciliationActions.js';
import { DAY_MEAL_TYPES, STAY_CANCEL_MARK, mealDecisionPlan, mealTimes } from './stayMealDecisions.js';

const LABEL = { BREAKFAST: 'בוקר', LUNCH: 'צהריים', DINNER: 'ערב' };
const appendNote = (notes, line) => [notes, line].filter(Boolean).join('\n');
// Key format matches the analyzer's uniqueImpacts keys, so the persisted OPEN item is reused.
const outsideImpact = m => ({ key: `MEALS:OUTSIDE_STAY:${m.date}:${m.id}`, module: 'MEALS', impact_type: 'OUTSIDE_STAY', date: m.date, summary: 'ארוחה מחוץ לתקופת השהייה החדשה', metadata: { entity: 'MealReservation', record_id: m.id, meal_type: m.meal_type }, action: 'CANCEL' });

async function resolveOpenByKey(db, change, key, email, resolution) {
  const rows = await db.OperationalStayReconciliation.filter({ stable_key: `${change.id}:${key}` });
  if (rows[0] && rows[0].status === 'OPEN') await resolveItem(db, rows[0], email, resolution);
}

// Fresh server-side recompute after the stay periods are persisted. Idempotent on retry.
export async function applyStayMealDecisions(db, change, plan, decisions, email) {
  const failures = [];
  const step = async fn => { try { await fn(); } catch (error) { failures.push(error.message); } };
  const [periods, meals, profiles, groups] = await Promise.all([
    readAll(db.GroupStayPeriod, { group_id: change.group_id, status: 'ACTIVE' }),
    readAll(db.MealReservation, { group_id: change.group_id }),
    db.OperationalGroupProfile.filter({ group_id: change.group_id }),
    db.Group.filter({ id: change.group_id }),
  ]);
  const fresh = mealDecisionPlan({ current: plan.currentPeriods, proposed: periods, meals, today: todayIL() });

  // Automatic: cancel future meals outside every active period through the existing CANCEL executor.
  for (const m of fresh.cancellations) await step(async () => {
    const task = await persistImpact(db, change, outsideImpact(m), email);
    await performItemAction(db, task, email, 'CANCEL');
  });
  for (const m of fresh.preserved_today) await step(async () => {
    const task = await persistImpact(db, change, outsideImpact(m), email);
    if (task.status === 'OPEN') await resolveItem(db, task, email, 'נשמרה — מועד הארוחה כבר החל היום');
  });

  // Explicit: admin choice per changed/checkout date.
  const byDate = new Map((Array.isArray(decisions) ? decisions : [])
    .filter(d => d && Array.isArray(d.meal_types))
    .map(d => [d.date, d.meal_types.filter(t => DAY_MEAL_TYPES.includes(t))]));
  const profile = profiles.length === 1 ? profiles[0] : null;
  const pax = Number(profile?.total_pax || groups[0]?.total_pax || 0);

  for (const day of fresh.dates) await step(async () => {
    const task = await persistImpact(db, change, { key: `MEALS:DAY_DECISION:${day.date}`, module: 'MEALS', impact_type: 'DAY_DECISION', date: day.date, summary: `${day.is_checkout ? 'יום עזיבה' : 'יום שהייה שהשתנה'} — נדרשת החלטת ארוחות`, metadata: {}, action: null }, email);
    if (task.status === 'RESOLVED') return;
    const chosen = byDate.get(day.date);
    if (!chosen) return; // stays OPEN: no fresh admin decision for this date
    const review = [];
    for (const type of DAY_MEAL_TYPES) {
      const rows = meals.filter(m => m.date === day.date && m.meal_type === type);
      const live = rows.find(r => r.status === 'ACTIVE');
      if (!chosen.includes(type)) {
        if (live && futureService(live)) await db.MealReservation.update(live.id, { status: 'CANCELLED', notes: appendNote(live.notes, `${STAY_CANCEL_MARK} (${change.id})`) });
        continue;
      }
      if (live) continue;
      const ours = rows.find(r => r.status === 'CANCELLED' && String(r.notes || '').includes(STAY_CANCEL_MARK));
      if (ours) {
        await db.MealReservation.update(ours.id, { status: 'ACTIVE', notes: appendNote(ours.notes, `הופעל מחדש בעקבות שינוי תקופת שהייה (${change.id})`), ...(ours.pax_sync_locked !== true && pax > 0 ? { pax } : {}) });
        continue;
      }
      if (rows.length) { review.push(`${LABEL[type]}: בוטלה בעבר — נדרשת בדיקה ידנית`); continue; }
      const times = mealTimes(type, fresh.pattern);
      if (!futureService({ date: day.date, start_time: times.start_time })) { review.push(`${LABEL[type]}: מועד הארוחה כבר חל`); continue; }
      if (!profile || pax <= 0) { review.push(`${LABEL[type]}: חסר פרופיל/מספר משתתפים`); continue; }
      await db.MealReservation.create({
        group_id: change.group_id, operational_group_profile_id: profile.id, date: day.date, meal_type: type,
        start_time: times.start_time, end_time: times.end_time, pax, pax_sync_locked: false,
        special_diets_summary: times.template?.special_diets_summary ?? profile.special_diets ?? '',
        sandwich_option: false, notes: `נוסף בעקבות שינוי תקופת שהייה (${change.id})`, source: 'manual', status: 'ACTIVE',
      });
    }
    await resolveOpenByKey(db, change, `MEALS:ADDED_DATE:${day.date}:`, email, 'טופל בהחלטת ארוחות מפורשת בשינוי השהייה');
    if (review.length) await persistImpact(db, change, { key: `MEALS:MANUAL_REVIEW:${day.date}`, module: 'MEALS', impact_type: 'MANUAL_REVIEW', date: day.date, summary: review.join(' · '), metadata: {}, action: null }, email);
    const picked = chosen.length ? chosen.map(t => LABEL[t]).join(', ') : 'ללא ארוחות';
    await resolveItem(db, task, email, `החלטת מנהל: ${picked}`);
  });

  if (failures.length) throw new Error(`ארוחות: ${failures.join(' · ')}`);
}