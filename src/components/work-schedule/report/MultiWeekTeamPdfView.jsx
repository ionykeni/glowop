import { renderToStaticMarkup } from "react-dom/server";
import { WEEK_STATUS_LABEL, fmtFullDate, weekLabel, unpublishedListText } from "@/lib/multiWeekTeamReport";
import { MULTI_WEEK_TEAM_PDF_STYLES } from "@/components/work-schedule/report/multiWeekTeamPdfStyles";

const ShiftLine = ({ shift }) => shift.isNight
  ? <div className="night">כונן לילה</div>
  : <div className="line">{shift.label}{shift.time && ` · ${shift.time}`}{shift.notes && <span className="notes"> · {shift.notes}</span>}</div>;

const WeekBlock = ({ weekStart, count, children }) => (
  <div className="week">
    <div className="week-band">שבוע {weekLabel(weekStart)} · {count} משמרות</div>
    <table><tbody>{children}</tbody></table>
  </div>
);

// One combined team document for several consecutive weeks, grouped by worker → week → day.
export default function MultiWeekTeamPdfView({ report }) {
  return (
    <main dir="rtl">
      <header className="pdf-header">
        <div>
          <h1>סידור עבודה – לפי עובדים</h1>
          <p className="date-range">{fmtFullDate(report.start)} – {fmtFullDate(report.end)}</p>
        </div>
        <div className="summary">{report.statuses.length} שבועות · {report.workers.length} עובדים</div>
      </header>
      <div className="weeks-status">
        {report.statuses.map((w) => (
          <span key={w.weekStart} className={`week-chip ${w.status === "PUBLISHED" ? "ok" : "missing"}`}>
            שבוע {weekLabel(w.weekStart)} · {w.status === "PUBLISHED" ? "פורסם" : `${WEEK_STATUS_LABEL[w.status] || w.status} – לא נכלל`}
          </span>
        ))}
      </div>
      {report.unpublished.length > 0 && <div className="warning">שים לב: מסמך חלקי. השבועות הבאים טרם פורסמו ואינם כלולים במסמך: {unpublishedListText(report)}</div>}
      {report.workers.length === 0 && <p className="empty">אין משמרות מפורסמות בתקופה שנבחרה</p>}
      {report.workers.map((worker) => (
        <section className="worker" key={worker.key}>
          <div className="worker-head"><h2>{worker.name}</h2><span>{worker.totalShifts} משמרות בתקופה</span></div>
          {worker.weeks.map((week) => (
            <WeekBlock key={week.weekStart} weekStart={week.weekStart} count={week.totalShifts}>
              {week.days.map((day) => (
                <tr key={day.date}>
                  <th>{day.dayName}<small>{day.dateLabel}</small></th>
                  <td>{day.shifts.map((shift) => <ShiftLine key={shift.id} shift={shift} />)}</td>
                </tr>
              ))}
            </WeekBlock>
          ))}
        </section>
      ))}
      {report.cleaning.length > 0 && (
        <section className="cleaning">
          <h2>ניקיון קבלן</h2>
          {report.cleaning.map((week) => (
            <WeekBlock key={week.weekStart} weekStart={week.weekStart} count={week.days.length}>
              {week.days.map((day) => (
                <tr key={day.date}>
                  <th>{day.dayName}<small>{day.dateLabel}</small></th>
                  <td>{[day.morning > 0 && `ניקיון בוקר: ${day.morning} מנקות`, day.evening > 0 && `ניקיון ערב: ${day.evening} מנקות`].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </WeekBlock>
          ))}
        </section>
      )}
    </main>
  );
}

export function generateMultiWeekTeamPdfHtml(report) {
  const markup = renderToStaticMarkup(<MultiWeekTeamPdfView report={report} />);
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>סידור עבודה לפי עובדים ${fmtFullDate(report.start)} – ${fmtFullDate(report.end)}</title>
  <style>${MULTI_WEEK_TEAM_PDF_STYLES}</style>
</head>
<body>${markup}</body>
</html>`;
}