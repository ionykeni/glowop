import PrisaDayChoice, { SLOT, PTYPE } from "@/components/groups/PrisaDayChoice";

const fmt = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const COFFEE = { HOT_WATER_THERMOCAN_ONLY: "מים חמים / תרמוקן בלבד" };
const coffeeLine = c => `${fmt(c.date)} ${c.start_time || ""} — ${COFFEE[c.coffee_corner_type] || c.coffee_corner_type || "פינת קפה"}${c.location_name_snapshot ? ` · ${c.location_name_snapshot}` : ""}`;
const prisaLine = p => `${fmt(p.date)} — ${SLOT[p.pickup_slot] || p.pickup_slot} · ${p.quantity} · ${PTYPE[p.type] || p.type}`;

export const prisaChoiceValid = c => c?.add === false || (c?.add === true && !!c.type && Number(c.quantity) > 0 && !!c.pickup_slot);

// Coffee + Prisa consequences. Cancellations are automatic on confirm; new dates need an explicit Prisa choice.
export default function ServiceDecisionPanel({ decision, value, onChange }) {
  const coffee = decision?.coffee || {}, prisa = decision?.prisa || {};
  const kept = [...(coffee.preserved_today || []).map(coffeeLine), ...(prisa.preserved_today || []).map(prisaLine)];
  const dates = prisa.added_dates || [];
  if (!coffee.cancellations?.length && !prisa.cancellations?.length && !kept.length && !dates.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
      <p className="font-semibold">השפעה על פינות קפה ופריסות</p>
      {coffee.cancellations?.length > 0 && <div className="rounded border border-teal-200 bg-card p-2 text-xs"><p className="font-semibold">פינות קפה שיבוטלו בעקבות שינוי התקופה</p><ul className="list-disc pr-5">{coffee.cancellations.map(c => <li key={c.id}>{coffeeLine(c)}</li>)}</ul></div>}
      {prisa.cancellations?.length > 0 && <div className="rounded border border-teal-200 bg-card p-2 text-xs"><p className="font-semibold">פריסות שיבוטלו בעקבות שינוי התקופה</p><ul className="list-disc pr-5">{prisa.cancellations.map(p => <li key={p.id}>{prisaLine(p)}</li>)}</ul></div>}
      {(coffee.cancellations?.length > 0 || prisa.cancellations?.length > 0) && <p className="text-xs text-muted-foreground">הרשומות יסומנו כמבוטלות ולא יימחקו.</p>}
      {kept.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">שירותים של היום יישמרו ללא שינוי: {kept.join(" · ")}</div>}
      {dates.map(day => <PrisaDayChoice key={day.date} day={day} template={prisa.template} value={value[day.date]} onChange={v => onChange({ ...value, [day.date]: v })} />)}
    </div>
  );
}