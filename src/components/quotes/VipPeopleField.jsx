import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Option-owned VIP sleeping headcount — availability planning only, never pricing. */
export default function VipPeopleField({ value, onChange, staffCount, optionLabel }) {
  const invalid = value > staffCount;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1 w-40">
          <Label className="text-xs text-slate-500">אנשים באוהלי VIP{optionLabel ? ` (${optionLabel})` : ""}</Label>
          <Input type="number" min="0" max={staffCount} value={value}
            onChange={e => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className={invalid ? "border-red-400" : ""} />
        </div>
        <div className="text-[11px] text-slate-400 pb-2">
          לבדיקת זמינות בלבד · צוות בלינה רגילה: {Math.max(0, staffCount - value)}
        </div>
      </div>
      {invalid && (
        <p className="text-xs text-red-600 mt-2">מספר האנשים ב־VIP ({value}) גדול ממספר הצוות ({staffCount}) — נא לתקן לפני שמירה</p>
      )}
    </div>
  );
}