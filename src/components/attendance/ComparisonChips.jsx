import { fmtMinutes, fmtSigned } from "@/lib/attendanceFormat";

// Planned (current published schedule) next to verified actual hours. Informational only.
export default function ComparisonChips({ comparison: c, verifiedMinutes }) {
  if (!c) return null;
  const items = [
    { label: "שעות מתוכננות בתקופה", value: fmtMinutes(c.planned_minutes) },
    { label: "הפרש: מאושר מול מתוכנן עד כה", value: fmtSigned(verifiedMinutes - c.planned_to_date_minutes) },
    { label: `משמרות עם רישום נוכחות (מתוך ${c.planned_shift_count})`, value: c.recorded_count },
    { label: "משמרות לבדיקה", value: c.review_count, cls: c.review_count > 0 ? "text-amber-700" : "" },
    c.extra_verified_minutes > 0 && { label: "שעות מחוץ למשמרת מתוכננת", value: fmtMinutes(c.extra_verified_minutes) },
  ].filter(Boolean);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-border bg-card px-3 py-2">
          <p className={`text-lg font-bold tabular-nums ${i.cls || "text-foreground"}`} dir="ltr">{i.value}</p>
          <p className="text-[11px] text-muted-foreground leading-tight">{i.label}</p>
        </div>
      ))}
    </div>
  );
}