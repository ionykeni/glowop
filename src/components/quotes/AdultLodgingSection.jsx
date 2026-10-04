import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { calcAdultLodgingLine } from "@/lib/quotePricing";

const ADULT_TENT_RATES = {
  BED3:  { label: "אוהל 3 מיטות",   rate: 340, capacity: 3 },
  BED68: { label: "אוהל 6/8 מיטות", rate: 250, capacity: 6 },
};
const fmtMoney = (n) => `₪${Math.round(Number(n) || 0).toLocaleString("he-IL")}`;
const FieldLabel = ({ children }) => <div className="text-[11px] text-slate-400 font-medium mb-0.5">{children}</div>;

/** Legacy regular adult lodging lines (BED3/BED68). adultsCount = regular (non-VIP) staff. */
export default function AdultLodgingSection({ lines, setLines, defaultNights, adultsCount }) {
  const update = (idx, field, val) => setLines(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }));
  const allocatedBeds = lines.reduce((sum, r) => {
    const cap = r.tent_type === "BED68" ? (r.actual_beds || 6) : (ADULT_TENT_RATES[r.tent_type]?.capacity ?? 0);
    return sum + (Number(r.tent_count) * cap);
  }, 0);
  const remaining = adultsCount - allocatedBeds;
  return (
    <div className="space-y-2">
      {adultsCount > 0 && (
        <div className={`text-xs px-3 py-1.5 rounded-lg font-medium inline-flex ${
          remaining > 0 ? "bg-amber-50 text-amber-700 border border-amber-200" :
          remaining === 0 ? "bg-green-50 text-green-700 border border-green-200" :
          "bg-blue-50 text-blue-600 border border-blue-200"
        }`}>
          {remaining > 0 ? `חסרות ${remaining} מקומות` : remaining === 0 ? `✓ כל ${adultsCount} מקומות מכוסות` : `עודף ${Math.abs(remaining)} מקומות`}
        </div>
      )}
      {lines.map((r, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5">
          <div className="col-span-4 space-y-0.5">
            <FieldLabel>סוג אוהל</FieldLabel>
            <Select value={r.tent_type} onValueChange={v => update(idx, "tent_type", v)}>
              <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ADULT_TENT_RATES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label} — ₪{v.rate}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-0.5">
            <FieldLabel>אוהלים</FieldLabel>
            <Input className="h-8 text-xs bg-white" type="number" min="0" value={r.tent_count} onChange={e => update(idx, "tent_count", e.target.value)} />
          </div>
          {r.tent_type === "BED68" && (
            <div className="col-span-2 space-y-0.5">
              <FieldLabel>מיטות</FieldLabel>
              <Select value={String(r.actual_beds || 6)} onValueChange={v => update(idx, "actual_beds", Number(v))}>
                <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 מיטות</SelectItem>
                  <SelectItem value="8">8 מיטות</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2 space-y-0.5">
            <FieldLabel>לילות</FieldLabel>
            <div className="h-8 flex items-center rounded-md border bg-white px-3 text-xs font-semibold">{defaultNights}</div>
          </div>
          <div className={r.tent_type === "BED68" ? "col-span-1" : "col-span-3"} />
          <div className="col-span-1 flex items-center gap-1 justify-end">
            <div className="text-xs font-semibold text-primary whitespace-nowrap">{fmtMoney(calcAdultLodgingLine(r, defaultNights))}</div>
            <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setLines(p => [...p, { tent_type: "BED3", tent_count: 0, nights: defaultNights || 1 }])} className="gap-1.5 text-xs h-7 border-dashed">
        <Plus className="w-3 h-3" /> הוסף שורה
      </Button>
    </div>
  );
}