// Pure validation/sanitization for ActivityDayTemplate (planning data only).
// Only whitelisted planning fields survive sanitization, so operational identifiers
// (group ids, shared_activity_id, split_group_id, CalendarSync ids...) can never be stored.

export const MAX_STATIONS = 50;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
export const LOGISTICS_FLAGS = [
  'needs_projector', 'needs_screen', 'needs_microphone',
  'needs_sound', 'needs_whiteboard', 'needs_chair_circle',
];

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function parseChairs(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// keepIds=false is used when copying into a new version: station ids are per version.
export function sanitizeStations(rawStations, { keepIds = true } = {}) {
  const list = Array.isArray(rawStations) ? rawStations : [];
  const seen = new Set();
  return list.map((raw, index) => {
    const s = raw && typeof raw === 'object' ? raw : {};
    let stationId = keepIds && typeof s.station_id === 'string' && STATION_ID_PATTERN.test(s.station_id) ? s.station_id : null;
    if (!stationId || seen.has(stationId)) stationId = crypto.randomUUID();
    seen.add(stationId);
    const station = {
      station_id: stationId,
      display_order: index + 1,
      title: text(s.title, 200),
      description: text(s.description, 2000),
      start_time: text(s.start_time, 5),
      end_time: text(s.end_time, 5),
      suggested_space_id: text(s.suggested_space_id, 64),
      chairs_count: parseChairs(s.chairs_count),
      logistics_other: text(s.logistics_other, 500),
      preparation_notes: text(s.preparation_notes, 2000),
    };
    for (const flag of LOGISTICS_FLAGS) station[flag] = s[flag] === true;
    return station;
  });
}

// Returns a list of { code, message, station_index? }. Empty list = valid.
// forReady adds completeness rules; spaceIds is a Set of existing ActivitySpace ids.
export function validateTemplate({ name, stations }, { forReady = false, spaceIds = new Set() } = {}) {
  const errors = [];
  const push = (code, message, station_index) => errors.push(station_index === undefined ? { code, message } : { code, message, station_index });
  if (!text(name, 200)) push('NAME_REQUIRED', 'יש להזין שם תבנית');
  if (!Array.isArray(stations)) { push('STATIONS_INVALID', 'רשימת התחנות אינה תקינה'); return errors; }
  if (stations.length > MAX_STATIONS) push('TOO_MANY_STATIONS', `ניתן להגדיר עד ${MAX_STATIONS} תחנות`);
  if (forReady && stations.length === 0) push('NO_STATIONS', 'יש להגדיר לפחות תחנה אחת לפני סימון כמוכנה');

  stations.forEach((s, i) => {
    const label = `תחנה ${i + 1}`;
    if (s.display_order !== i + 1) push('ORDER_INVALID', `${label}: סדר התחנות אינו תקין`, i);
    if (forReady && !s.title) push('TITLE_REQUIRED', `${label}: חסר שם פעילות`, i);
    for (const [field, title] of [['start_time', 'שעת התחלה'], ['end_time', 'שעת סיום']]) {
      if (s[field] && !TIME_PATTERN.test(s[field])) push('TIME_INVALID', `${label}: ${title} אינה בפורמט HH:mm`, i);
      else if (forReady && !s[field]) push('TIME_REQUIRED', `${label}: חסרה ${title}`, i);
    }
    if (TIME_PATTERN.test(s.start_time || '') && TIME_PATTERN.test(s.end_time || '') && toMinutes(s.end_time) <= toMinutes(s.start_time)) {
      push('END_BEFORE_START', `${label}: שעת הסיום חייבת להיות אחרי שעת ההתחלה`, i);
    }
    if (s.chairs_count !== null && (!Number.isInteger(s.chairs_count) || s.chairs_count < 0)) {
      push('CHAIRS_INVALID', `${label}: כמות הכיסאות חייבת להיות מספר שלם אי-שלילי`, i);
    }
    if (s.suggested_space_id && !spaceIds.has(s.suggested_space_id)) push('SPACE_NOT_FOUND', `${label}: המרחב המוצע אינו קיים`, i);
  });
  return errors;
}