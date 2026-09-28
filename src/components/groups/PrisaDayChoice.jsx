import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const fmt = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const SLOT = { AFTER_BREAKFAST: "אחרי ארוחת בוקר", AFTER_LUNCH: "אחרי ארוחת צהריים", AFTER_DINNER: "אחרי ארוחת ערב" };
export const PTYPE = { REGULAR: "רגיל", DOUBLE: "כפול" };
const sel = "h-8 rounded-md border border-input bg-card px-2 text-xs";

export default function PrisaDayChoice({ day, template, value, onChange }) {
  const set = patch => onChange({ ...value, date: day.date, ...patch });
  return (
    <div className="space-y-2 rounded border border-border bg-card p-2 text-xs">
      <p className="font-semibold">פריסה בתאריך {fmt(day.date)}?{day.is_checkout ? " (יום עזיבה)" : ""}</p>
      {day.existing.length > 0 && <p className="text-muted-foreground">קיימות בתאריך: {day.existing.map(p => `${PTYPE[p.type]} ×${p.quantity} ${SLOT[p.pickup_slot]}${p.status === "CANCELLED" ? " (מבוטלת)" : ""}`).join(" · ")}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant={value?.add === false ? "default" : "outline"} onClick={() => onChange({ date: day.date, add: false })}>לא נדרשת פריסה</Button>
        <Button size="sm" variant={value?.add === true ? "default" : "outline"} onClick={() => set({ add: true })}>כן — להוסיף פריסה</Button>
      </div>
      {value?.add === true && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={sel} value={value.type || ""} onChange={e => set({ type: e.target.value })}><option value="">סוג</option>{Object.entries(PTYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <Input type="number" min="1" className="h-8 w-24 text-xs" placeholder="כמות" value={value.quantity ?? ""} onChange={e => set({ quantity: e.target.value })} />
          <select className={sel} value={value.pickup_slot || ""} onChange={e => set({ pickup_slot: e.target.value })}><option value="">מועד איסוף</option>{Object.entries(SLOT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {template && <Button size="sm" variant="ghost" onClick={() => set({ type: template.type, quantity: template.quantity, pickup_slot: template.pickup_slot })}>העתק מהפריסה הקודמת</Button>}
        </div>
      )}
    </div>
  );
}