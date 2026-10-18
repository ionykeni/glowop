// Live (client) totals and warnings for the actual-sleeping report editor.
// The server recomputes everything on submit — these are display only.
export const WARNING_LABELS = {
  MIXED: "בנים ובנות באותו אוהל",
  OVER_CAPACITY: "מעל קיבולת האוהל",
  NOT_ASSIGNED_TENT: "אוהל שאינו משובץ לקבוצה (חריגה)",
};

export function entryWarnings(entry, tent, assigned) {
  const boys = Number(entry.boys || 0);
  const girls = Number(entry.girls || 0);
  const w = [];
  if (boys > 0 && girls > 0) w.push("MIXED");
  if (tent?.capacity && boys + girls > tent.capacity) w.push("OVER_CAPACITY");
  if (!assigned && boys + girls > 0) w.push("NOT_ASSIGNED_TENT");
  return w;
}

export function computeTotals(entries) {
  return entries.reduce((a, e) => {
    const b = Number(e.boys || 0), g = Number(e.girls || 0);
    return { boys: a.boys + b, girls: a.girls + g, total: a.total + b + g };
  }, { boys: 0, girls: 0, total: 0 });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatPeriod(p) {
  if (!p) return "";
  const f = (d) => d ? d.split("-").reverse().join("/") : "";
  return p.start === p.end ? f(p.start) : `${f(p.start)} – ${f(p.end)}`;
}