import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function UnitsEditor({ units, onChange }) {
  const update = (i, label) => onChange(units.map((u, j) => (j === i ? { ...u, label } : u)));
  const add = () => onChange([...units, { unit_key: `U${Date.now().toString(36)}`, label: "" }]);
  const remove = (i) => onChange(units.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">יחידות מעקב (כל אחת עם מונה ימים נפרד)</p>
      {units.map((u, i) => (
        <div key={u.unit_key} className="flex items-center gap-2">
          <Input value={u.label} onChange={(e) => update(i, e.target.value)} placeholder="לדוגמה: שכונה 8" maxLength={40} />
          <button type="button" onClick={() => remove(i)} className="p-2 text-muted-foreground hover:text-red-600" aria-label="הסר יחידה">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1 text-xs font-semibold text-primary">
        <Plus className="w-3.5 h-3.5" /> הוספת יחידה
      </button>
      <p className="text-[11px] text-muted-foreground">הסרת יחידה מפסיקה את המעקב אחריה; היסטוריית הניקויים שלה נשמרת.</p>
    </div>
  );
}