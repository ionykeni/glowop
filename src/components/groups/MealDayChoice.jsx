import { Checkbox } from "@/components/ui/checkbox";

const OPTIONS = [["BREAKFAST", "ארוחת בוקר"], ["LUNCH", "ארוחת צהריים"], ["DINNER", "ארוחת ערב"]];
const ALL_TYPES = ["BREAKFAST", "LUNCH", "DINNER"];
const fmt = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const title = day => day.is_checkout ? "יום עזיבה — ארוחות ביום העזיבה" : day.is_arrival ? "יום הגעה" : "יום שהייה שנוסף/השתנה";

// value: undefined = no decision yet | [] = ללא ארוחות | ["BREAKFAST", ...]
export default function MealDayChoice({ day, value, onChange }) {
  const selected = value || [];
  const none = Array.isArray(value) && value.length === 0;
  const toggle = (type, on) => {
    const next = on ? [...selected.filter(t => t !== type), type] : selected.filter(t => t !== type);
    onChange(next.length ? next : undefined);
  };
  const dropped = Array.isArray(value) ? day.existing_active.filter(t => !value.includes(t)) : [];

  // כל הארוחות: selectable only when all three meal types are individually eligible.
  // Never silently overrides blocked / manual-review meal types.
  const blockedTypes = ALL_TYPES.filter(type =>
    day.needs_review.includes(type) || (day.elapsed.includes(type) && !day.existing_active.includes(type))
  );
  const allEligible = blockedTypes.length === 0;
  const allSelected = ALL_TYPES.every(type => selected.includes(type));

  return (
    <div className="space-y-1.5 rounded border border-sky-200 bg-card p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold"><span dir="ltr">{fmt(day.date)}</span> — {title(day)}</p>
        {!Array.isArray(value) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">נדרשת בחירה</span>}
      </div>
      {day.suggestion && <p className="text-muted-foreground">הצעה לפי הדפוס הקיים: בוקר, צהריים וערב (לא נבחר אוטומטית)</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {OPTIONS.map(([type, label]) => {
          const blocked = day.needs_review.includes(type) || (day.elapsed.includes(type) && !day.existing_active.includes(type));
          const tag = day.existing_active.includes(type) ? "קיימת" : day.needs_review.includes(type) ? "בוטלה בעבר — לבדיקה ידנית" : day.elapsed.includes(type) ? "המועד חלף" : day.reactivatable.includes(type) ? "תופעל מחדש" : null;
          return (
            <label key={type} className={`flex items-center gap-1.5 ${blocked ? "opacity-60" : ""}`}>
              <Checkbox checked={selected.includes(type)} disabled={blocked} onCheckedChange={v => toggle(type, v === true)} />
              <span>{label}</span>
              {tag && <span className="text-[10px] text-muted-foreground">({tag})</span>}
            </label>
          );
        })}
        <label className={`flex items-center gap-1.5 ${allEligible ? "" : "opacity-60"}`} title={allEligible ? undefined : "לא ניתן לבחור — חלק מהארוחות חסומות לבדיקה ידנית"}>
          <Checkbox
            checked={allSelected}
            disabled={!allEligible}
            onCheckedChange={v => onChange(v === true ? [...ALL_TYPES] : undefined)}
          />
          <span>כל הארוחות</span>
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox checked={none} onCheckedChange={v => onChange(v === true ? [] : undefined)} />
          <span>ללא ארוחות</span>
        </label>
      </div>
      {dropped.length > 0 && <p className="text-amber-700">ארוחות קיימות שלא סומנו יבוטלו (אם מועדן טרם חל).</p>}
    </div>
  );
}