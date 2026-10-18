import { formatPeriod, formatDateTime } from "@/lib/mechinaSleepingReportCalc";
export default function ReportPeriodHeader({ ctx, onPeriodChange }) {
  return <div className="rounded-xl border border-border bg-card p-4 space-y-2">
    <p className="font-semibold">{ctx.group.group_name}</p>
    <label className="block text-sm">תקופת שהייה
      <select value={ctx.period.key} onChange={e => onPeriodChange(e.target.value)} className="block mt-1 w-full rounded-lg border border-border bg-background p-2">
        {ctx.periods.map(p => <option key={p.key} value={p.key}>{formatPeriod(p)}</option>)}
      </select>
    </label>
    {ctx.draft && <p className="text-xs text-muted-foreground">טיוטה שמורה מ-{formatDateTime(ctx.draft.updated_at)}</p>}
    <p className="text-xs text-muted-foreground">הנתון הצפוי והשיבוץ הרשמי מוצגים לקריאה בלבד. אם אין שיבוץ, ניתן לבחור אוהלים רגילים ממפת האתר; לא מוצגים נתוני קבוצות אחרות.</p>
  </div>;
}