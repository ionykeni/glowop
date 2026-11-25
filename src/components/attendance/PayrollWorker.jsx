import { fmtDay, addDays } from "@/lib/attendanceFormat";
import PayrollSummary from "./PayrollSummary";
import PayrollDailyTable from "./PayrollDailyTable";
import PayrollPendingTable from "./PayrollPendingTable";
import { PAYROLL_REASONS } from "./payrollPresentation";

export default function PayrollWorker({ worker, month }) {
  return <article aria-label={worker.full_name} className="space-y-2 border-t border-warm-line pt-4">
    <PayrollSummary summary={worker} title={`${worker.full_name} · ${month}`} />
    {worker.review_weeks.length > 0 && <details className="rounded-xl bg-cream-deep/65 px-4 py-2.5 text-xs">
      <summary className="cursor-pointer font-semibold">נדרש בירור · {worker.review_weeks.length} שבועות</summary>
      <ul className="mt-2 space-y-2">{worker.review_weeks.map(({ week, reasons }) => <li key={week}>
        <b>{fmtDay(week)} – {fmtDay(addDays(week, 6))}: </b>{reasons.map((reason) => PAYROLL_REASONS[reason]).join(" ")}
      </li>)}</ul>
    </details>}
    {worker.days.length > 0 && <PayrollDailyTable days={worker.days} />}
    {worker.pending.length > 0 && <PayrollPendingTable requests={worker.pending} />}
    {!worker.days.length && !worker.pending.length && <p className="px-4 py-2 text-sm text-muted-foreground">אין רשומות נוכחות לעובד בחודש זה.</p>}
  </article>;
}