import { Fragment } from "react";
import { fmtDay } from "@/lib/attendanceFormat";
import { duration, endText, PAYROLL_HEADERS, PAYROLL_SUMMARY, rowStatus, stamp } from "./payrollPresentation";

const cell = "px-3 py-2 align-top text-start";

export default function PayrollDailyTable({ days }) {
  return <div className="att-card overflow-hidden">
    <h4 className="att-head">רשומות יומיות</h4>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-xs sm:text-sm" aria-label="רשומות נוכחות יומיות">
        <thead className="bg-cream/70 text-muted-foreground"><tr>{PAYROLL_HEADERS.map((h) => <th scope="col" key={h} className={cell}>{h}</th>)}</tr></thead>
        <tbody>{days.map((day) => <Fragment key={day.date}>
          {day.rows.map((row, i) => <tr key={row.id} className={`border-t border-warm-line/40 ${row.kind !== "verified" ? "bg-cream/50 text-muted-foreground" : ""}`}>
            <td className={`${cell} whitespace-nowrap font-semibold`}>{i === 0 && fmtDay(day.date)}</td>
            <td className={`${cell} whitespace-nowrap`}>{stamp(row.start_at)}</td><td className={cell}>{endText(row)}</td>
            <td className={cell}><bdi dir="ltr">{duration(row.session_ms)}</bdi>{row.day_ms != null && row.day_ms !== row.session_ms && <small className="block">חלק ביום: <bdi dir="ltr">{duration(row.day_ms)}</bdi></small>}</td>
            <td className={`${cell} font-semibold`}><bdi dir="ltr">{duration(row.counted_ms)}</bdi></td><td className={cell}>{rowStatus(row)}</td>
          </tr>)}
          <tr className="bg-sage/60"><td colSpan={6} className="px-3 py-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1"><strong>סה״כ ליום</strong>
              {Object.entries(PAYROLL_SUMMARY).filter(([k]) => k === "verified" || day.hours[k] > 0).map(([k, label]) => <span key={k}>{label}: <bdi dir="ltr">{duration(day.hours[k])}</bdi></span>)}
            </div>
          </td></tr>
        </Fragment>)}</tbody>
      </table>
    </div>
  </div>;
}