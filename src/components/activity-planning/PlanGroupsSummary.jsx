// Informational only: each selected group counted once. Not an approval condition.
export default function PlanGroupsSummary({ summary }) {
  if (!summary.group_count) return null;
  return (
    <p className="text-xs text-slate-500">
      {summary.group_count} קבוצות ייחודיות בתוכנית · {summary.registered_participants} משתתפים רשומים (לידיעה בלבד)
      {summary.unknown_count > 0 && ` · ל-${summary.unknown_count} קבוצות כמות לא ידועה`}
    </p>
  );
}