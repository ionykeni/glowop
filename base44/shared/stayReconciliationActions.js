import { isDateInsideStayPeriods } from './groupStayPeriods.js';
import { readAll, todayIL } from './stayReconciliationCore.js';
export async function persistImpact(db, change, impact, email) {
  const stable_key = `${change.id}:${impact.key}`;
  const rows = await db.OperationalStayReconciliation.filter({ stable_key });
  if (rows[0]) return rows[0];
  return await db.OperationalStayReconciliation.create({ group_id: change.group_id, change_id: change.id, stable_key, module: impact.module, impact_type: impact.impact_type, date: impact.date, end_date: impact.end_date || impact.date, summary: impact.summary, metadata: { ...impact.metadata, action: impact.action || null }, status: 'OPEN', requested_by: email });
}
export async function resolveItem(db, item, email, resolution) {
  await db.OperationalStayReconciliation.update(item.id, { status:'RESOLVED', resolved_at:new Date().toISOString(), resolved_by:email, resolution });
}
export function futureService(row) {
  const today = todayIL();
  const time = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  return row.date > today || row.date === today && !!row.start_time && row.start_time > time;
}
export async function performItemAction(db, item, email, action) {
  if (item.status === 'RESOLVED') return;
  if (action === 'REVIEWED') {
    if (['SLEEPING','SYSTEM'].includes(item.module)) throw new Error('יש להשלים את הטיפול בפועל');
    await resolveItem(db,item,email,'נבדק ידנית — נשמרה החלטת המנהל'); return;
  }
  const periods = await readAll(db.GroupStayPeriod,{group_id:item.group_id,status:'ACTIVE'});
  const meta = item.metadata || {};
  if (action === 'CANCEL' && meta.action === 'CANCEL' && ['MealReservation','PrisaRequest'].includes(meta.entity)) {
    const row = await db[meta.entity].get(meta.record_id);
    if (!row || row.group_id !== item.group_id) throw new Error('לא נמצאה הרשומה המקושרת');
    if (row.status === 'CANCELLED') { await resolveItem(db,item,email,'הרשומה כבר בוטלה'); return; }
    if (isDateInsideStayPeriods(row.date,periods)) { await resolveItem(db,item,email,'הרשומה נמצאת בתקופת שהייה תקינה'); return; }
    if (!futureService(row)) throw new Error('אין לבטל שירות שכבר חל; יש לבדוק ידנית');
    const reason = `בוטל בעקבות שינוי תקופת שהייה (${item.change_id})`;
    await db[meta.entity].update(row.id,{status:'CANCELLED',notes:[row.notes,reason].filter(Boolean).join('\n'),...(meta.entity === 'PrisaRequest' ? {cancelled_date:new Date().toISOString()} : {})});
    await resolveItem(db,item,email,reason); return;
  }
  if (action === 'ADD_MEALS' && item.module === 'MEALS' && meta.action === 'ADD_MEALS') {
    if (!periods.some(p => p.start_date < item.date && item.date < p.end_date)) throw new Error('יש לבדוק ארוחות ביום הגעה/עזיבה או מחוץ לשהייה');
    for (const template of meta.templates || []) {
      const rows = await readAll(db.MealReservation,{group_id:item.group_id,date:item.date,meal_type:template.meal_type});
      if (rows.some(r => r.status === 'ACTIVE')) continue;
      if (rows.some(r => r.status === 'CANCELLED')) throw new Error('ארוחה מסוג זה בוטלה בעבר; נדרשת החלטה ידנית');
      if (!futureService({date:item.date,start_time:template.start_time})) throw new Error('מועד הארוחה כבר חל');
      const profiles = await db.OperationalGroupProfile.filter({group_id:item.group_id});
      if (profiles.length !== 1) throw new Error('יש לבדוק את פרופיל הקבוצה');
      await db.MealReservation.create({...template, group_id:item.group_id,operational_group_profile_id:profiles[0].id,date:item.date,source:'manual',status:'ACTIVE'});
    }
    await resolveItem(db,item,email,'נוספו רק הארוחות החסרות לפי הדפוס שאושר'); return;
  }
  throw new Error('יש להשלים את הטיפול במודול המתאים');
}