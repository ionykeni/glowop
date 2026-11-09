import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISCOUNT_TYPE } from "@/lib/quoteDiscount";

const fmtMoney = value => `₪${Number(value || 0).toLocaleString("he-IL")}`;

const TYPES = [
  { id: DISCOUNT_TYPE.PERCENT, label: "אחוזים (%)" },
  { id: DISCOUNT_TYPE.FIXED,   label: "סכום קבוע (₪)" },
];

/**
 * Discount type selector + matching value field (percentage or fixed NIS amount).
 * The parent owns the discount state; this component only renders and reports changes.
 */
export default function QuoteDiscountFields({ type, percent, amount, discountAmount, onChange }) {
  const isFixed = type === DISCOUNT_TYPE.FIXED;
  // Switching to a fixed amount starts from the discount currently shown, never from a stale value.
  const selectType = id => {
    if (id === DISCOUNT_TYPE.FIXED && !(Number(amount) > 0)) onChange("discount_amount", String(discountAmount || 0));
    onChange("discount_type", id);
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        {TYPES.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => selectType(opt.id)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${type === opt.id ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <Label className="text-xs text-slate-500 block">{isFixed ? "סכום הנחה (₪)" : "הנחה (%)"}</Label>
      {isFixed
        ? <Input type="number" min="0" step="1" value={amount} onChange={e => onChange("discount_amount", e.target.value)} />
        : <Input type="number" min="0" max="100" value={percent} onChange={e => onChange("discount_percent", e.target.value)} />}
      {discountAmount > 0 && <div className="text-xs text-red-500">−{fmtMoney(discountAmount)}</div>}
    </div>
  );
}