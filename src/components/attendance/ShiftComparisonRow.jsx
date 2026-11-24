import DiffLine, { TONE_PILL } from "./DiffLine";
import { shiftDetails } from "./attendanceReportPresentation";

export default function ShiftComparisonRow({ shift }) {
  const s = shiftDetails(shift);
  return (
    <tr className="border-t border-warm-line/60 align-top transition-colors duration-150 hover:bg-cream/70">
      <th scope="row" className="px-4 py-3 text-start font-semibold">
        <span className="whitespace-nowrap">{s.date}</span>
        <span className="block font-normal text-muted-foreground">{s.label}</span>
      </th>
      <td className="px-3 py-3 tabular-nums">
        {s.planned ? <><bdi dir="ltr">{s.planned}</bdi>{s.overnight && <span className="block text-muted-foreground">עד למחרת</span>}</> : <span className="text-muted-foreground">כוננות</span>}
      </td>
      <td className="px-3 py-3 tabular-nums">
        {s.actual ? <bdi dir="ltr" className="font-medium">{s.actual}</bdi> : <span className="text-muted-foreground">—</span>}
        {s.sessions.map((x, i) => <span key={i} className="block text-muted-foreground"><bdi dir="ltr">{x.time}</bdi>{x.label && ` · ${x.label}`}</span>)}
      </td>
      <td className="space-y-1 px-3 py-3">
        {s.entry ? <><DiffLine label="כניסה" {...s.entry} /><DiffLine label="יציאה" {...s.exit} /></>
          : <span className="inline-flex rounded-full bg-cream-deep/70 px-2.5 py-0.5 font-medium text-muted-foreground">{s.status}</span>}
        {s.notes.map((n) => <p key={n} className="text-[11px] text-amber-700">{n}</p>)}
      </td>
      <td className="px-4 py-3 text-end">
        {s.total ? <span className={`inline-flex rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ring-1 ${TONE_PILL[s.total.tone]}`}><bdi dir="ltr">{s.total.text}</bdi></span>
          : <span className="text-muted-foreground">—</span>}
      </td>
    </tr>
  );
}