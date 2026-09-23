import { naturalTentCodeCompare } from '@/components/sleeping/tentCodeSort';

const datePart = value => typeof value === 'string' ? value.slice(0, 10) : '';
const yesterdayOf = date => {
  const previous = new Date(`${date}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
};

export function historicalDateRange(group, periods, today) {
  const multi = group?.stay_mode === 'MULTI_PERIOD';
  const stays = multi ? periods.filter(p => p.status !== 'CANCELLED' && p.start_date && p.end_date && p.start_date < p.end_date) :
    group?.arrival_date && group?.departure_date && group.arrival_date < group.departure_date ? [{ start_date: group.arrival_date, end_date: group.departure_date }] : [];
  const min = stays.map(p => p.start_date).sort()[0] || '';
  const end = stays.map(p => p.end_date).sort().at(-1) || '';
  const max = end ? [yesterdayOf(end), yesterdayOf(today)].sort()[0] : '';
  const latestStayNight = stays.map(p => ({ start: p.start_date, last: [yesterdayOf(p.end_date), yesterdayOf(today)].sort()[0] })).filter(p => p.last >= p.start).map(p => p.last).sort().at(-1) || '';
  return { min, max, initial: latestStayNight, stays };
}

// Pure read model. Checkout dates are exclusive; a cancelled placeholder is never proof of occupancy.
export function buildHistoricalSleepingSnapshot({ group, date, periods = [], allocations = [], tents = [], neighborhoods = [], today }) {
  const range = historicalDateRange(group, periods, today);
  if (!date || date < range.min || date > range.max || date >= today) return { state: 'invalid', sections: [], warnings: [] };
  const stay = range.stays.find(p => p.start_date <= date && date < p.end_date);
  if (!stay) return { state: 'absent', sections: [], warnings: [] };
  const warnings = new Set();
  const tentById = new Map(tents.map(t => [t.id, t]));
  const hoodById = new Map(neighborhoods.map(n => [n.id, n]));
  const matched = allocations.filter(row => {
    if (row.group_id !== group.id) return false;
    const start = row.segment_start_date || row.arrival_date;
    const end = row.segment_end_date || row.departure_date;
    if (!start || !end) { warnings.add('לחלק מהרשומות חסרים תאריכי מקטע.'); return false; }
    if (!(start <= date && date < end)) return false;
    if (row.stay_period_id && stay.id && row.stay_period_id !== stay.id) {
      warnings.add('קיימות רשומות מתקופה אחרת שחופפות לתאריך; הן לא נכללו.');
      return false;
    }
    if (datePart(row.created_date) > date) {
      warnings.add('קיימות רשומות שנוצרו אחרי התאריך שנבחר; אי אפשר להניח שהיו שיבוצים באותו יום.');
      return false;
    }
    if (row.status === 'CANCELLED') {
      warnings.add('קיימות רשומות שבוטלו ללא מקטע היסטורי מאומת; הן לא מוצגות כתפוסה.');
      return false;
    }
    if (row.status !== 'CONFIRMED') warnings.add('חלק מהרשומות אינן מאושרות כיום; אין תיעוד מלא למועד אישורן ההיסטורי.');
    if (!row.allocation_series_id && !row.segment_start_date && !row.segment_end_date && datePart(row.updated_date) > date) warnings.add('רשומות ישנות עודכנו אחרי התאריך ללא מקטעים; ייתכן שכמות או מיקום קודמים אינם מתועדים.');
    return true;
  });
  const seenTent = new Set();
  const sections = [
    { key: 'students', label: 'שכונות חניכים', rows: [] },
    { key: 'vip', label: 'VIP', rows: [] },
    { key: 'alternative', label: 'אוהלים חלופיים', rows: [] },
    { key: 'unknown', label: 'שיבוצים ללא סיווג', rows: [] },
  ];
  for (const row of matched) {
    const tent = tentById.get(row.tent_id);
    const hood = hoodById.get(row.neighborhood_id);
    if (!tent || !hood || tent.neighborhood_id !== row.neighborhood_id) warnings.add('לחלק מהרשומות חסר זיהוי מאומת של אוהל או שכונה.');
    if (!Number.isFinite(Number(row.allocated_pax)) || !row.gender_group) warnings.add('לחלק מהרשומות חסרים כמות או מגדר.');
    if (row.tent_id && seenTent.has(row.tent_id)) warnings.add('קיימים מקטעים חופפים לאותו אוהל; יש לבדוק את הנתונים ההיסטוריים.');
    seenTent.add(row.tent_id);
    const marker = String(row.notes || '');
    const section = marker.includes('__alt_tent__') ? sections[2] : /__vip_req_\d+__/i.test(marker) || tent?.tent_type === 'VIP' ? sections[1] : row.allocation_type === 'STUDENT' ? sections[0] : null;
    if (!section) warnings.add('קיימות רשומות שסוג השיבוץ שלהן אינו מזוהה.');
    (section || sections[3]).rows.push({ id: row.id, tent: tent?.neighborhood_id === row.neighborhood_id ? tent.code : null, neighborhood: hood?.id === tent?.neighborhood_id ? hood.name : null, pax: row.allocated_pax, gender: row.gender_group, type: row.allocation_type, start: row.segment_start_date || row.arrival_date, end: row.segment_end_date || row.departure_date });
  }
  for (const section of sections) section.rows.sort((a, b) => naturalTentCodeCompare(a.tent || '', b.tent || ''));
  if (!matched.length) warnings.add('לא נמצאו שיבוצים מאומתים בתאריך זה; ייתכן שמידע ישן אינו מלא.');
  return { state: 'present', sections, warnings: [...warnings] };
}