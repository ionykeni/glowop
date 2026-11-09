// Pure, read-only planning/validation helpers for previewing an activity day from a READY template.
// Nothing here writes data. Stay semantics reuse groupStayPeriods.js (the existing source of truth);
// space-overlap semantics mirror activitySpaceAvailability.js (unchanged production checker).
import { isValidDateString, validateStayPeriods } from './groupStayPeriods.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DAY_END = 24 * 60;
export const isTime = (t) => TIME_PATTERN.test(String(t || ''));
export const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;
const unverifiable = (reason, message, extra = {}) => ({ state: 'UNVERIFIABLE', reason, message, ...extra });

// Presence inside one known stay interval. Boundary days require the boundary time; a missing time
// is reported as UNVERIFIABLE instead of assuming a full day.
function windowFor(date, start, end, arrivalTime, departureTime, source) {
  const period = { start_date: start, end_date: end, arrival_time: arrivalTime || null, departure_time: departureTime || null, source };
  const isArr = date === start;
  const isDep = date === end;
  if (isArr && !isTime(arrivalTime)) return unverifiable('MISSING_ARRIVAL_TIME', 'יום הגעה ללא שעת הגעה — לא ניתן לאמת נוכחות', { period });
  if (isDep && !isTime(departureTime)) return unverifiable('MISSING_DEPARTURE_TIME', 'יום עזיבה ללא שעת עזיבה — לא ניתן לאמת נוכחות', { period });
  const from = isArr ? toMinutes(arrivalTime) : 0;
  const to = isDep ? toMinutes(departureTime) : DAY_END;
  if (to <= from) return unverifiable('CONTRADICTORY_TIMES', 'שעת העזיבה אינה אחרי שעת ההגעה', { period });
  return { state: isArr || isDep ? 'PARTIAL' : 'FULL_DAY', from, to, is_arrival: isArr, is_departure: isDep, period };
}

// Date-level presence of one Group. Never treats the MULTI_PERIOD envelope as continuous.
export function groupDayPresence(group, periods, date) {
  if (!isValidDateString(date)) return unverifiable('INVALID_DATE', 'תאריך לא תקין');
  if (group.stay_mode === 'MULTI_PERIOD') {
    const active = (periods || []).filter(p => p.group_id === group.id && p.status !== 'CANCELLED');
    if (active.length === 0) {
      const inEnvelope = isValidDateString(group.arrival_date) && isValidDateString(group.departure_date)
        && group.arrival_date <= date && date <= group.departure_date;
      return inEnvelope ? unverifiable('NO_STAY_PERIODS', 'קבוצה רב-תקופתית ללא תקופות שהייה פעילות') : { state: 'NOT_PRESENT' };
    }
    if (!validateStayPeriods(active).valid) return unverifiable('INVALID_STAY_PERIODS', 'תקופות השהייה של הקבוצה אינן תקינות (חפיפה או תאריך שגוי)');
    const period = active.find(p => p.start_date <= date && date <= p.end_date);
    if (!period) return { state: 'NOT_PRESENT' };
    return windowFor(date, period.start_date, period.end_date, period.arrival_time, period.departure_time, 'STAY_PERIOD');
  }
  const arrival = group.arrival_date;
  if (!isValidDateString(arrival)) return { state: 'NOT_PRESENT' };
  if (group.group_type === 'DAY_USE') {
    return date === arrival ? windowFor(date, arrival, arrival, group.arrival_time, group.departure_time, 'GROUP_DAY_USE') : { state: 'NOT_PRESENT' };
  }
  const departure = String(group.departure_date || '').trim();
  if (!isValidDateString(departure)) {
    // Existing readers treat a missing departure as "arrival day only"; its end time is unknown.
    return date === arrival ? unverifiable('MISSING_DEPARTURE_DATE', 'לקבוצה אין תאריך עזיבה') : { state: 'NOT_PRESENT' };
  }
  if (departure < arrival) {
    return departure <= date && date <= arrival ? unverifiable('CONTRADICTORY_DATES', 'תאריך העזיבה מוקדם מתאריך ההגעה') : { state: 'NOT_PRESENT' };
  }
  if (date < arrival || date > departure) return { state: 'NOT_PRESENT' };
  return windowFor(date, arrival, departure, group.arrival_time, group.departure_time, 'GROUP_CONTINUOUS');
}

export const isSelectablePresence = (p) => p.state === 'FULL_DAY' || p.state === 'PARTIAL';

// Station-level: the whole station interval must fit inside the group's on-site window that day.
export function stationGroupCheck(presence, startTime, endTime) {
  if (!presence) return { ok: false, code: 'GROUP_NOT_ELIGIBLE', message: 'הקבוצה אינה שוהה באתר בתאריך זה' };
  if (presence.state === 'UNVERIFIABLE') return { ok: false, code: 'GROUP_UNVERIFIABLE', message: presence.message };
  if (!isSelectablePresence(presence)) return { ok: false, code: 'GROUP_NOT_ELIGIBLE', message: 'הקבוצה אינה שוהה באתר בתאריך זה' };
  if (!isTime(startTime) || !isTime(endTime)) return { ok: false, code: 'GROUP_UNVERIFIABLE', message: 'שעות התחנה חסרות' };
  if (toMinutes(startTime) < presence.from || toMinutes(endTime) > presence.to) {
    return { ok: false, code: 'OUTSIDE_STAY_WINDOW', message: 'שעות התחנה חורגות משעות השהייה של הקבוצה ביום זה' };
  }
  return { ok: true };
}

const localMinutes = (date, time) => {
  const [y, mo, d] = String(date).split('-').map(Number);
  const [h, mi] = String(time).split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
};
// Same semantics as blockOverlaps in activitySpaceAvailability.js.
export function blockOverlaps(block, date, startTime, endTime) {
  const start = localMinutes(date, startTime);
  const end = localMinutes(date, endTime);
  const blockStart = localMinutes(block.start_date, block.start_time);
  if (block.is_open_ended) return end > blockStart;
  return start < localMinutes(block.end_date, block.end_time) && blockStart < end;
}

export const STATUS_ORDER = ['UNAVAILABLE', 'BOOKED', 'OVER_CAPACITY', 'PENDING', 'UNVERIFIABLE', 'AVAILABLE'];
export const worstStatus = (issues) => issues.reduce((w, i) => (STATUS_ORDER.indexOf(i.status) < STATUS_ORDER.indexOf(w) ? i.status : w), 'AVAILABLE');

// ctx: { date, spacesById, blocks, groupItems, standalone, standaloneSpaceIdsByReservation, pendingRequests, stations }
export function evaluateStationSpace(station, ctx) {
  const issues = [];
  const { start_time: s, end_time: e } = station;
  if (!isTime(s) || !isTime(e) || toMinutes(e) <= toMinutes(s)) {
    return [{ status: 'UNVERIFIABLE', code: 'INVALID_TIMES', message: 'שעות התחנה חסרות או ששעת הסיום אינה אחרי שעת ההתחלה' }];
  }
  if (!station.space_id) return [{ status: 'UNVERIFIABLE', code: 'NO_SPACE', message: 'לא נבחר מרחב' }];
  const space = ctx.spacesById[station.space_id];
  if (!space) return [{ status: 'UNAVAILABLE', code: 'SPACE_NOT_FOUND', message: 'המרחב לא נמצא' }];
  if (space.is_bookable === false || (space.working_status && space.working_status !== 'WORKING')) {
    issues.push({ status: 'UNAVAILABLE', code: 'SPACE_UNAVAILABLE', message: 'המרחב אינו פעיל או אינו זמין להזמנה' });
  }
  const sm = toMinutes(s), em = toMinutes(e);
  for (const b of ctx.blocks) {
    if (b.activity_space_id === space.id && b.status === 'ACTIVE' && blockOverlaps(b, ctx.date, s, e)) {
      issues.push({ status: 'UNAVAILABLE', code: 'SPACE_BLOCK', message: `המרחב חסום${b.is_open_ended ? ' עד שחרור' : ''}${b.reason_notes ? `: ${b.reason_notes}` : ''}` });
    }
  }
  for (const it of ctx.groupItems) {
    if (it.activity_space_id === space.id && it.status === 'ACTIVE' && overlaps(sm, em, toMinutes(it.start_time), toMinutes(it.end_time))) {
      issues.push({ status: 'BOOKED', code: 'GROUP_SCHEDULE_ITEM', message: `תפוס: ${it.activity_name || 'פעילות קבוצה'} ${it.start_time}–${it.end_time}` });
    }
  }
  for (const r of ctx.standalone) {
    const spaceIds = ctx.standaloneSpaceIdsByReservation[r.id] || [];
    if (r.status === 'ACTIVE' && spaceIds.includes(space.id) && overlaps(sm, em, toMinutes(r.start_time), toMinutes(r.end_time))) {
      issues.push({ status: 'BOOKED', code: 'STANDALONE_ACTIVITY', message: `תפוס: ${r.title || 'פעילות עצמאית'} ${r.start_time}–${r.end_time}` });
    }
  }
  for (const r of ctx.pendingRequests) {
    if (r.space_id === space.id && r.status === 'PENDING' && overlaps(sm, em, toMinutes(r.start_time), toMinutes(r.end_time))) {
      issues.push({ status: 'PENDING', code: 'PENDING_REQUEST', message: `בקשה ממתינה (לא הזמנה מאושרת) ${r.start_time}–${r.end_time}` });
    }
  }
  // One logical station = one physical use, whatever the number of groups. Different stations compete.
  for (const other of ctx.stations) {
    if (other.station_id === station.station_id || other.space_id !== space.id) continue;
    if (!isTime(other.start_time) || !isTime(other.end_time)) continue;
    if (overlaps(sm, em, toMinutes(other.start_time), toMinutes(other.end_time))) {
      issues.push({ status: 'BOOKED', code: 'INTER_STATION_CONFLICT', message: `חופף לתחנה "${other.title || 'ללא שם'}" ${other.start_time}–${other.end_time} באותו מרחב` });
    }
  }
  const total = station.total_participants;
  const cap = Number(space.capacity);
  if (!(Number.isFinite(cap) && cap > 0)) {
    issues.push({ status: 'UNVERIFIABLE', code: 'UNKNOWN_CAPACITY', message: 'קיבולת המרחב אינה ידועה' });
  } else if (Number.isFinite(total) && total > cap) {
    issues.push({ status: 'OVER_CAPACITY', code: 'OVER_CAPACITY', message: `${total} משתתפים — מעל קיבולת ${cap}` });
  }
  return issues;
}

// participants entered for a group; null/invalid = missing.
export function participantIssue(value, group) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < 0) {
    return { status: 'UNVERIFIABLE', code: 'MISSING_PARTICIPANTS', message: 'חסרה כמות משתתפים' };
  }
  const known = Number(group?.participant_count);
  if (Number.isFinite(known) && known > 0 && n > known) {
    return { status: 'UNVERIFIABLE', code: 'PARTICIPANTS_ABOVE_GROUP', message: `הכמות (${n}) גבוהה ממספר המשתתפים בקבוצה (${known})` };
  }
  return null;
}