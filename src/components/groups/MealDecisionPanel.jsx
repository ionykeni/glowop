import MealDayChoice from "@/components/groups/MealDayChoice";

const fmt = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const TYPE = { BREAKFAST: "ארוחת בוקר", LUNCH: "ארוחת צהריים", DINNER: "ארוחת ערב", COFFEE_CORNER: "פינת קפה", OTHER: "אחר" };
const line = m => `${fmt(m.date)} — ${TYPE[m.meal_type] || m.meal_type}${m.start_time ? ` (${m.start_time})` : ""}`;

// Meal consequences of a stay change. Cancellations are automatic on confirm; changed dates need explicit choice.
export default function MealDecisionPanel({ decision, value, onChange }) {
  const cancellations = decision?.cancellations || [];
  const preserved = decision?.preserved_today || [];
  const dates = decision?.dates || [];
  if (!cancellations.length && !preserved.length && !dates.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="font-semibold">השפעה על ארוחות</p>
      {cancellations.length > 0 && (
        <div className="space-y-1 rounded border border-sky-200 bg-card p-2 text-xs">
          <p className="font-semibold">ארוחות שיבוטלו עם אישור השינוי (מחוץ לתקופות השהייה):</p>
          <ul className="list-disc space-y-0.5 pr-5">{cancellations.map(m => <li key={m.id}>{line(m)}</li>)}</ul>
          <p className="text-muted-foreground">הארוחות יסומנו כמבוטלות ולא יימחקו.</p>
        </div>
      )}
      {preserved.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          ארוחות של היום שמועדן כבר החל יישמרו ללא שינוי: {preserved.map(line).join(" · ")}
        </div>
      )}
      {dates.length > 0 && <p className="text-xs font-semibold">יש לבחור ארוחות לכל יום שנוסף או השתנה (לא ייווצרו ארוחות ללא בחירה):</p>}
      {dates.map(day => (
        <MealDayChoice key={day.date} day={day} value={value[day.date]} onChange={v => onChange({ ...value, [day.date]: v })} />
      ))}
    </div>
  );
}