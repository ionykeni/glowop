import { fmtDay } from "@/lib/attendanceFormat";
import { PAYROLL_REQUEST_HEADERS, PAYROLL_REQUEST_TYPES, requestStatus, stamp } from "./payrollPresentation";

export default function PayrollPendingTable({ requests }) {
  return <div className="att-card overflow-hidden">
    <h4 className="att-head">בקשות תיקון ממתינות</h4>
    <p className="px-3 pt-3 text-xs text-muted-foreground">השעות המבוקשות לא נספרות עד לאישור.</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-xs sm:text-sm" aria-label="בקשות תיקון ממתינות">
        <thead><tr>{PAYROLL_REQUEST_HEADERS.map((h) => <th key={h} scope="col" className="px-3 py-2 text-start text-muted-foreground">{h}</th>)}</tr></thead>
        <tbody>{requests.map((r) => <tr className="border-t border-warm-line/60" key={r.id}>
          {[fmtDay(r.date), PAYROLL_REQUEST_TYPES[r.type], stamp(r.start_at), stamp(r.end_at), requestStatus(r)].map((value, i) => <td key={i} className="px-3 py-2">{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}