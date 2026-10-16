// Activity creation window guard — blocks creating NEW activities for a group
// that has already departed (today is strictly after the group's departure_date).
// Editing or cancelling existing activities remains allowed.
// "Today" is resolved in Asia/Jerusalem so the lock aligns with the operational day.

export function todayInJerusalem() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function isGroupDeparted(group, today = todayInJerusalem()) {
  const dep = group?.departure_date;
  if (!dep) return false;
  return today > dep;
}

export const GROUP_ALREADY_DEPARTED_CODE = 'GROUP_ALREADY_DEPARTED';
export const GROUP_ALREADY_DEPARTED_MESSAGE = 'לא ניתן להוסיף פעילויות לקבוצה שעזבה את האתר';