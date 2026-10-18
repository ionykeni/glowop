import { genderLabel } from "@/lib/mechinaSleepingReportCalc";
import ReportSummaryBar from "@/components/mechina/sleeping-report/ReportSummaryBar";
export default function ReportVersionContent({ version: v }) {
  const snapshot = v.snapshot;
  const ids = new Set(snapshot.entries.map(e => e.tent_id));
  const rows = [...snapshot.entries, ...(v.current_tents || []).filter(t => !ids.has(t.id)).map(t => ({ tent_id: t.id, tent_code: t.code, neighborhood_name: t.neighborhood_name, capacity: t.capacity, unreported: true }))];
  return <div className="space-y-3">
    <ReportSummaryBar expected={v.expected_students} totals={{ boys: v.total_boys, girls: v.total_girls, total: v.total_students }} />
    <p className="text-xs text-muted-foreground">״רשמי בהגשה״ הוא השיבוץ בעת הדיווח; ״רשמי כיום״ הוא השיבוץ במערכת לתקופה זו כעת. אין עדכון אוטומטי.</p>
    <div className="overflow-x-auto"><table className="w-full text-xs text-right">
      <thead><tr className="border-b border-border text-muted-foreground">{["שכונה", "אוהל", "רשמי בהגשה", "רשמי כיום", "בפועל", "מגדר", "קיבולת", "הערה / חריגה"].map(h => <th key={h} className="p-2 whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{rows.map(e => {
        const count = e.count ?? e.total;
        const current = v.current_official?.[e.tent_id];
        return <tr key={e.tent_id} className={`border-b border-border ${count !== current ? "bg-primary/5" : ""}`}>
          <td className="p-2">{e.neighborhood_name}</td><td className="p-2 font-bold">{e.tent_code}</td>
          <td className="p-2">{e.official_pax ?? "—"}</td><td className="p-2">{current ?? "מחוץ לתחום הנוכחי"}</td>
          <td className="p-2 font-bold">{e.unreported ? "לא דווח" : count}</td>
          <td className="p-2">{e.unreported ? "—" : e.gender !== undefined ? genderLabel(e.gender) : e.boys && e.girls ? `דיווח ישן: ${e.boys} בנים / ${e.girls} בנות` : genderLabel(e.boys ? "BOYS" : e.girls ? "GIRLS" : "")}</td>
          <td className="p-2">{e.capacity}</td><td className="p-2 whitespace-pre-wrap">{e.note || "—"}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {snapshot.general_notes && <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{snapshot.general_notes}</p>}
  </div>;
}