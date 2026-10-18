// Legacy snapshots remain readable; new edits always use count + one gender.
export const WARNING_LABELS = {
  MIXED: "דיווח ישן עם שני מגדרים: יש לבחור מגדר אחד ולפרט בהערה",
  OVER_CAPACITY: "הכמות חייבת להיות מספר שלם בין 0 לקיבולת האוהל",
  MISSING_GENDER: "יש לבחור בנים או בנות כשמספר הלנים גדול מ-0",
  NOT_ASSIGNED_TENT: "אוהל שאינו משובץ רשמית לקבוצה",
};
export const genderLabel = g => g === "BOYS" ? "בנים" : g === "GIRLS" ? "בנות" : "לא נבחר";
export function normalizeEntry(e = {}) {
  const count = e.count ?? (Number(e.boys || 0) + Number(e.girls || 0));
  const mixed = e.count === undefined && e.boys > 0 && e.girls > 0;
  return { count, gender: e.gender ?? (mixed ? "" : e.boys > 0 ? "BOYS" : e.girls > 0 ? "GIRLS" : ""),
    note: mixed ? `${e.note || ""}\nדיווח קודם: ${e.boys} בנים ו-${e.girls} בנות. יש לבחור מגדר ולפרט חריגה.`.trim() : e.note || "", reported: e.reported ?? (count > 0) };
}
export function entryWarnings(entry, tent, assigned) {
  const e = normalizeEntry(entry), w = [];
  if (!Number.isInteger(e.count) || e.count < 0 || e.count > (tent?.capacity ?? 0)) w.push("OVER_CAPACITY");
  if (e.count > 0 && !["BOYS", "GIRLS"].includes(e.gender)) w.push("MISSING_GENDER");
  if (!assigned && e.count > 0) w.push("NOT_ASSIGNED_TENT");
  return w;
}
export function computeTotals(entries) {
  return entries.reduce((a, raw) => {
    const e = normalizeEntry(raw);
    return { boys: a.boys + (e.gender === "BOYS" ? e.count : 0), girls: a.girls + (e.gender === "GIRLS" ? e.count : 0), total: a.total + e.count };
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