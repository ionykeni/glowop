import { duration, PAYROLL_LEGAL, PAYROLL_SUMMARY } from "./payrollPresentation";

export default function PayrollSummary({ summary, title, team = false }) {
  return <div className="att-card space-y-3 overflow-hidden p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{summary.worked_days} {team ? "ימי עבודה מצטברים עם שעות מאומתות" : "ימים עם שעות מאומתות"} · {summary.pending_count} בקשות ממתינות</p>
    </div>
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {Object.entries(PAYROLL_SUMMARY).map(([key, label]) => <div key={key} className={`rounded-xl px-3 py-2 ${key === "verified" ? "bg-sage text-sage-foreground" : "bg-cream"}`}>
        <dt className="text-xs">{label}</dt><dd className="text-base font-bold tabular-nums"><bdi dir="ltr">{duration(summary.hours[key])}</bdi></dd>
      </div>)}
    </dl>
    <div className="border-t border-warm-line/70 pt-3">
      <h4 className="mb-2 text-sm">סיווג שעות מאומתות</h4>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {Object.entries(PAYROLL_LEGAL).map(([key, label]) => <div key={key} className={`rounded-xl px-3 py-2 ${key === "unresolved" && summary.legal[key] ? "bg-cream-deep font-semibold" : "bg-muted/40"}`}>
          <dt className="text-xs">{label}</dt><dd className="text-sm tabular-nums"><bdi dir="ltr">{duration(summary.legal[key])}</bdi></dd>
        </div>)}
      </dl>
      {(summary.legal.weekly_rest > 0 || summary.legal.holiday > 0) && <p className="mt-2 text-xs text-muted-foreground">שעות במנוחה או בחג זוהו לפי מועדים מאומתים; שיעורי התגמול וסיווג שעות נוספות בזמנים אלה דורשים בירור.</p>}
    </div>
  </div>;
}