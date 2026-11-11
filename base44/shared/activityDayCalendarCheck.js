// Read-only comparison of an app activity with its mirrored Google Calendar event (evidence, never a write).
// The existing workflow (syncCommonSpaceToCalendar) is the only writer of these events.
export function compareEvent(item, event, spaceName) {
  if (!event) return { state: 'MISSING_IN_GOOGLE', details: 'האירוע לא נמצא ביומן Google' };
  if (event.status === 'cancelled') return { state: 'MISSING_IN_GOOGLE', details: 'האירוע מבוטל ביומן Google' };
  const diffs = [];
  const start = String(event.start?.dateTime || '').slice(0, 16), end = String(event.end?.dateTime || '').slice(0, 16);
  if (start !== `${item.date}T${item.start_time}` || end !== `${item.date}T${item.end_time}`) diffs.push(`שעות ביומן: ${start.slice(11)}–${end.slice(11)}`);
  if (spaceName && event.location !== spaceName) diffs.push(`מיקום ביומן: ${event.location || '—'}`);
  if (!String(event.summary || '').startsWith(String(item.activity_name || ''))) diffs.push('שם הפעילות ביומן שונה');
  return diffs.length ? { state: 'MISMATCH', details: diffs.join(' · ') } : { state: 'OK', details: null };
}

// Cancelled items: the workflow deletes the event and then the CalendarSync row. A remaining row = not yet confirmed.
export const cancelledItemState = (hasSyncRow) => (hasSyncRow
  ? { state: 'STALE_EVENT', details: 'הפעילות בוטלה אך עדיין לא אומתה הסרת האירוע מיומן Google' }
  : { state: 'REMOVED', details: null });