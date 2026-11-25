import { emptyLegal, classifyPayrollWeek } from './payrollHoursLegal.js';
import { inMonth } from './payrollHoursCalendar.js';
import { emptyHours, buildPayrollDays } from './payrollHoursSessions.js';

const group = (records) => {
  const map = new Map();
  for (const r of records) {
    if (!r.worker_profile_id) continue;
    if (!map.has(r.worker_profile_id)) map.set(r.worker_profile_id, []);
    map.get(r.worker_profile_id).push(r);
  }
  return map;
};
const add = (target, x) => { for (const k of Object.keys(target)) target[k] += x[k]; };
const sortByName = (a, b) => a.full_name.localeCompare(b.full_name, 'he');

export function buildPayrollHoursReport({ records, requests, arrangements, profiles, workerId, range, now }) {
  const recordsBy = group(records), requestsBy = group(requests), arrangementsBy = group(arrangements);
  const directory = new Map(profiles.map((p) => [p.id, { id: p.id, full_name: p.full_name || 'עובד ללא שם', active: p.is_active !== false }]));
  for (const r of [...records, ...requests]) if (r.worker_profile_id && !directory.has(r.worker_profile_id)) {
    directory.set(r.worker_profile_id, { id: r.worker_profile_id, full_name: r.worker_name_snapshot || 'עובד ללא שם', active: false });
  }
  const workers = [];
  const team = { hours: emptyHours(), legal: emptyLegal(), worked_days: 0, pending_count: 0 };
  for (const person of [...directory.values()].sort(sortByName)) {
    if (workerId && person.id !== workerId) continue;
    const input = buildPayrollDays(recordsBy.get(person.id) || [], requestsBy.get(person.id) || [], range, now);
    const worker = { id: person.id, full_name: person.full_name, hours: emptyHours(), legal: emptyLegal(), worked_days: 0,
      pending_count: input.pending.length, pending: input.pending, days: [], review_weeks: [] };
    for (const [week, days] of input.weeks) {
      const display = days.filter((d) => inMonth(d.date, range));
      if (!display.some((d) => d.rows.length) && !input.pending.some((r) => display.some((d) => d.date === r.date))) continue;
      const legal = classifyPayrollWeek(week, days, arrangementsBy.get(person.id) || []);
      if (legal.reasons.length) worker.review_weeks.push({ week, reasons: legal.reasons });
      for (const d of display) {
        if (!d.rows.length) continue;
        worker.days.push({ date: d.date, hours: d.hours, rows: d.rows });
        add(worker.hours, d.hours);
        add(worker.legal, legal.days.get(d.date));
        if (d.hours.verified > 0) worker.worked_days += 1;
      }
    }
    if (!workerId && !person.active && !worker.days.length && !worker.pending_count) continue;
    workers.push(worker);
    add(team.hours, worker.hours);
    add(team.legal, worker.legal);
    team.worked_days += worker.worked_days;
    team.pending_count += worker.pending_count;
  }
  return { workers, team, workers_list: [...directory.values()].sort(sortByName).map(({ id, full_name }) => ({ id, full_name })) };
}