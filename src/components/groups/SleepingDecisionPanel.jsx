import { Button } from "@/components/ui/button";

const fmt = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—";
const label = r => `${r.is_vip ? "VIP " : r.is_alt_tent ? "חילופי " : ""}${r.tent_code} — ${r.allocated_pax}`;

// Explicit keep-same-sleeping decision at the stay-period change boundary. No default choice.
export default function SleepingDecisionPanel({ decision, value, onChange }) {
  if (!decision?.required) return null;
  const repair = decision.mode === "REPAIR";
  const blocked = decision.blocked?.length > 0;
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">{repair ? "נמצא שיבוץ לינה שאינו תואם לתאריכי התקופה" : "שינוי תקופת השהייה משפיע על שיבוץ הלינה"}</p>
      {!repair && <p className="text-xs">קיים שיבוץ לינה לתקופה זו.</p>}
      {decision.periods.map(p => (
        <div key={p.period_id} className="space-y-1 rounded border border-amber-200 bg-card p-2 text-xs">
          <p>השיבוץ הקיים: <strong dir="ltr">{fmt(p.old_period.start_date)}–{fmt(p.old_period.end_date)}</strong></p>
          <p>{repair ? "תקופת השהייה" : "תקופת השהייה החדשה"}: <strong dir="ltr">{fmt(p.target_period.start_date)}–{fmt(p.target_period.end_date)}</strong></p>
          <p className="text-muted-foreground">{p.rows.map(label).join(" · ")}</p>
        </div>
      ))}
      {blocked && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          לא ניתן לשמור את אותו השיבוץ — אוהלים תפוסים בתאריכים החדשים: {decision.blocked.map(b => b.tent_code || b.message).join(", ")}. ניתן לבחור להשאיר את הלינה ללא שינוי.
        </div>
      )}
      {decision.warnings?.length > 0 && <p className="text-xs">שים לב: קבוצה נוספת משתמשת באותה שכונה בתאריכים אלה (אזהרה בלבד).</p>}
      {!repair && <p className="text-xs font-semibold">האם לשמור את אותו השיבוץ גם בתאריכים החדשים?</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={value === true ? "default" : "outline"} disabled={blocked} onClick={() => onChange(true)}>
          {repair ? "עדכן את השיבוץ לתאריכי התקופה" : "כן, עדכן את השיבוץ"}
        </Button>
        <Button type="button" size="sm" variant={value === false ? "default" : "outline"} onClick={() => onChange(false)}>
          {repair ? "המשך ללא עדכון השיבוץ" : "לא, אשאיר את הלינה ללא שינוי"}
        </Button>
      </div>
    </div>
  );
}