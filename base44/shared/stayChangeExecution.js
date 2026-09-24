import { pick, readAll, todayIL } from './stayReconciliationCore.js';
import { applyTrims, applyKeptSleepingDates, reconcileNeighborhoods } from './staySleepingApply.js';
import { persistImpact, performItemAction } from './stayReconciliationActions.js';
import { planSleepingDecision } from './staleSleepingDates.js';
import { trimPeriodRows } from './staySleepingPlan.js';
const PERIOD_FIELDS = ['start_date','end_date','arrival_time','departure_time','notes','status'];
const same = (a,b) => PERIOD_FIELDS.every(k => (a?.[k] || '') === (b?.[k] || ''));
export async function executeStayChange(base44, change, plan, actions, email) {
  const db = base44.asServiceRole.entities, failures = [];
  const periods = await readAll(db.GroupStayPeriod,{group_id:change.group_id});
  const idByKey = new Map();
  let applied = false;
  const keep = actions.extend_sleeping === true;
  const ownLive = () => readAll(db.SleepingAllocation,{group_id:change.group_id,status:{$in:['DRAFT','CONFIRMED']}});
  const decide = async proposed => {
    const [rows,tents,reservations] = await Promise.all([readAll(db.SleepingAllocation,{status:{$in:['DRAFT','CONFIRMED']}}),readAll(db.Tent),readAll(db.NeighborhoodReservation,{status:'ACTIVE'})]);
    return planSleepingDecision({group:plan.group,rows,tents,reservations,today:todayIL()},proposed);
  };
  const blockedMessage = blocked => `לא ניתן לשמור את אותו שיבוץ בתאריכים החדשים: ${blocked.map(b => b.tent_code || b.message).join(', ')}`;
  // Fresh global availability check before the FIRST write; never silently choose other tents.
  if (keep) {
    const check = await decide(plan.proposed);
    if (check.blocked.length) {
      const message = blockedMessage(check.blocked);
      await db.OperationalStayChange.update(change.id,{state:'PENDING',last_message:message});
      return {success:false,applied:false,error:'SLEEPING_TENT_CONFLICT',blocked:check.blocked,change_id:change.id,message};
    }
  }
  try {
    // Optimistic check: every existing period must still be either before or our intended after.
    for (const before of plan.currentPeriods) {
      const row = periods.find(p => p.id === before.id);
      const after = plan.proposed.find(p => p.id === before.id) || {...before,status:'CANCELLED'};
      if (!same(row,before) && !same(row,after)) throw new Error('תקופות השהייה נערכו שוב; יש לפתוח תצוגה מקדימה חדשה');
    }
    if (periods.some(p => p.status === 'ACTIVE' && !plan.currentPeriods.some(b => b.id === p.id) && !plan.proposed.some(a => p.stay_change_key === `${change.id}:${a.period_key}`))) throw new Error('נוספה תקופת שהייה מאז האישור');
    await db.OperationalStayChange.update(change.id,{state:'APPLYING'});
    for (const period of plan.proposed) {
      const payload = {...pick(period,PERIOD_FIELDS),arrival_time:period.arrival_time || null,departure_time:period.departure_time || null,notes:period.notes || null,status:'ACTIVE'};
      let row = period.id ? periods.find(p => p.id === period.id) : periods.find(p => p.stay_change_key === `${change.id}:${period.period_key}`);
      if (row && same(row,payload)) { idByKey.set(period.period_key,row.id); continue; }
      const today = todayIL();
      if (!row && period.start_date < today || row && row.end_date <= today || row && row.start_date < today && (period.start_date !== row.start_date || period.end_date < today)) throw new Error('הזמן התקדם מאז האישור; תאריכים היסטוריים לא שונו');
      row = row ? await db.GroupStayPeriod.update(row.id,payload) : await db.GroupStayPeriod.create({...payload,group_id:change.group_id,stay_change_key:`${change.id}:${period.period_key}`});
      idByKey.set(period.period_key,row.id);
    }
    for (const before of plan.periodCancels) {
      const row = periods.find(p => p.id === before.id);
      if (row?.status === 'CANCELLED') continue;
      if (row.start_date < todayIL()) throw new Error('לא ניתן להסיר תקופה שכבר החלה');
      await db.GroupStayPeriod.update(row.id,{status:'CANCELLED'});
    }
    applied = true;
    await db.OperationalStayChange.update(change.id,{state:'APPLIED',applied_at:new Date().toISOString()});
  } catch (error) {
    failures.push(error.message);
    // No destructive rollback: return the actual persisted periods, including partial stay writes.
    const actual = await readAll(db.GroupStayPeriod,{group_id:change.group_id,status:'ACTIVE'});
    await db.OperationalStayChange.update(change.id,{state:'PENDING',last_message:error.message});
    return {success:false,applied:false,partial:true,change_id:change.id,periods:actual,message:'חלק מהשמירה דורש בדיקה. מוצגים התאריכים שנשמרו בפועל; אין להניח שהשינוי בוטל.',failures};
  }
  const attempt = async fn => { try { await fn(); } catch(error) { failures.push(error.message); } };
  await attempt(async () => {
    const actual = (await readAll(db.GroupStayPeriod,{group_id:change.group_id,status:'ACTIVE'})).sort((a,b) => a.start_date.localeCompare(b.start_date));
    await db.Group.update(change.group_id,{arrival_date:actual[0].start_date,departure_date:actual.at(-1).end_date,arrival_time:actual[0].arrival_time || null,departure_time:actual.at(-1).departure_time || null});
  });
  const tasks = [];
  for (const impact of plan.impacts) await attempt(async () => { tasks.push(await persistImpact(db,change,impact,email)); });
  let sleepingFailed = false;
  const sleepingAttempt = async fn => { const before = failures.length; await attempt(fn); if (failures.length > before) sleepingFailed = true; };
  if (keep) {
    // Revalidate against the persisted periods, move the same rows, then trim from fresh state (idempotent on retry).
    let kept = null;
    await sleepingAttempt(async () => {
      const actual = await readAll(db.GroupStayPeriod,{group_id:change.group_id,status:'ACTIVE'});
      const next = await decide(actual);
      if (next.blocked.length) throw new Error(blockedMessage(next.blocked));
      kept = { next, actual };
    });
    if (kept) {
      for (const u of kept.next.updates) await sleepingAttempt(() => applyKeptSleepingDates(db,u.row,u.data));
      if (!sleepingFailed) await sleepingAttempt(async () => { const t = trimPeriodRows(await ownLive(),kept.actual,todayIL()); await applyTrims(db,'SleepingAllocation',t.updates,t.cancels); });
    }
    if (sleepingFailed) await attempt(() => persistImpact(db,change,{key:'SLEEPING:KEEP_FAILED',module:'SLEEPING',impact_type:'KEEP_FAILED',date:todayIL(),summary:'עדכון שיבוץ הלינה לתאריכי השהייה החדשים לא הושלם; נדרשת בדיקה',metadata:{}},email));
  } else {
    await sleepingAttempt(() => applyTrims(db,'SleepingAllocation',plan.allocationUpdates,plan.allocationCancels));
  }
  await attempt(() => applyTrims(db,'NeighborhoodReservation',plan.reservationUpdates,plan.reservationCancels));
  await attempt(() => reconcileNeighborhoods(db,change.group_id,change,email));
  for (let i=0;i<plan.impacts.length;i++) {
    const impact = plan.impacts[i]; const action = actions[impact.key];
    if (!action || !impact.action || action !== impact.action) continue;
    const task = tasks.find(t => t.stable_key === `${change.id}:${impact.key}`);
    if (task) await attempt(() => performItemAction(db,task,email,action));
  }
  await db.OperationalStayChange.update(change.id,{state:failures.length ? 'PENDING' : 'DONE',last_message:failures.join(' · ').slice(0,1500)});
  const open = await readAll(db.OperationalStayReconciliation,{change_id:change.id,status:'OPEN'});
  if (sleepingFailed) return {success:false,applied,partial:true,change_id:change.id,status:'STAY_CHANGE_APPLIED_SLEEPING_PENDING',pending_count:open.length,failures,message:`תאריכי השהייה עודכנו, אך עדכון שיבוץ הלינה לא הושלם: ${failures.join(' · ')}`};
  return {success:true,applied,change_id:change.id,status:failures.length || open.length ? 'STAY_CHANGE_APPLIED_WITH_PENDING_RECONCILIATION' : 'STAY_CHANGE_APPLIED',pending_count:open.length,failures,message:failures.length || open.length ? 'השהייה עודכנה. פריטים שדורשים טיפול נשמרו בקבוצה.' : 'השהייה עודכנה. מצב הלינה נבדק לפי השיבוץ בפועל.'};
}