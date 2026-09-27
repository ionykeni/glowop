const LABELS = {
  INVALID_DATE: "יש להזין תאריכים תקינים", OVERLAPPING_PERIODS: "תקופות השהייה חופפות", DUPLICATE_PERIOD: "קיימת תקופה כפולה", MIN_TWO_ACTIVE_PERIODS: "יש להשאיר לפחות שתי תקופות פעילות", PERIOD_MUST_INCLUDE_SLEEPING_NIGHT: "כל תקופה חייבת לכלול לפחות לילה אחד", HISTORICAL_PERIOD_IMMUTABLE: "לא ניתן לשנות תקופה שהסתיימה", STARTED_PERIOD_CANNOT_BE_REMOVED_OR_REWRITTEN: "לא ניתן להסיר או לשכתב תקופה שכבר החלה", NEW_PERIOD_CANNOT_START_IN_PAST: "לא ניתן להוסיף תקופה בעבר", SAME_TENT_CONFLICT: "האוהל הקבוע תפוס בתאריכים המוצעים", NEIGHBORHOOD_CONFLICT: "קיימת התנגשות שכונה ללא אישור שיתוף", SITE_SLEEPING_CAPACITY_EXCEEDED: "חריגה מקיבולת הלינה באתר", INCOMPLETE_SLEEPING_SERIES: "סדרת הלינה הקיימת אינה שלמה", LEGACY_SLEEPING_LINKAGE_REQUIRED: "קיימות הקצאות לינה ישנות שאינן מקושרות לתקופות",
};
const count = value => value?.length || 0;

export default function ActiveStayChangeSummary({ preview }) {
  if (!preview) return null;
  return (
    <div className="space-y-3 text-sm">
      {preview.blocking_errors?.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"><p className="font-semibold">לא ניתן להחיל את השינוי</p><ul className="mt-2 list-disc pr-5 space-y-1">{preview.blocking_errors.map((item, index) => <li key={`${item.code}-${index}`}>{LABELS[item.code] || item.code}</li>)}</ul></div>}
      <div className="rounded-lg border border-border bg-muted/20 p-3 grid grid-cols-2 gap-2 text-xs">
        <span>תקופות שנוספו</span><strong>{count(preview.period_diff?.added)}</strong><span>תקופות שהוסרו</span><strong>{count(preview.period_diff?.removed)}</strong><span>תקופות שהשתנו</span><strong>{count(preview.period_diff?.changed)}</strong><span>לילות שנוספו / הוסרו</span><strong>{count(preview.period_diff?.added_sleeping_nights)} / {count(preview.period_diff?.removed_sleeping_nights)}</strong><span>שורות לינה לעדכון / יצירה / ביטול</span><strong>{preview.sleeping_impact?.rows_to_update || 0} / {preview.sleeping_impact?.rows_to_create || 0} / {preview.sleeping_impact?.rows_to_cancel || 0}</strong><span>ארוחות לביטול</span><strong>{count(preview.meal_decision?.cancellations ?? preview.meal_impact?.cancellations)}</strong>
      </div>
      {preview.warnings?.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800"><p className="font-semibold">אזהרות לבדיקה</p><ul className="mt-1 list-disc pr-5 text-xs">{preview.warnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.code}</li>)}</ul></div>}
      {preview.allowed && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">הבדיקה הושלמה ללא חסימות. האוהלים נשארים זהים והמערכת תסנכרן תקופות, לינה, שכונות וארוחות.</div>}
    </div>
  );
}