import { shiftDetails } from "./attendanceReportPresentation";

export default function ShiftComparisonRow({ shift }) {
  const s = shiftDetails(shift);
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="px-3 py-2 text-start font-medium"><span className="whitespace-nowrap">{s.date}</span><span className="block text-muted-foreground">{s.label}</span></th>
      <td className="px-3 py-2 tabular-nums">{s.planned ? <><bdi dir="ltr">{s.planned}</bdi>{s.overnight && <span className="block text-muted-foreground">עד למחרת</span>}</> : "כוננות לילה"}</td>
      <td className="px-3 py-2 tabular-nums">{s.sessions.length ? s.sessions.map((session, i) => <p key={i}><bdi dir="ltr">{session.time}</bdi>{session.label && <span className="block text-muted-foreground">{session.label}</span>}</p>) : "—"}</td>
      <td className="space-y-0.5 px-3 py-2 text-muted-foreground">{s.notes.length ? s.notes.map((note) => <p key={note}>{note}</p>) : "—"}</td>
    </tr>
  );
}