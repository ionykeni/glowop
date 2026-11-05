import { Users } from "lucide-react";
import { Input } from "@/components/ui/input";

// Admin approval to share a NEIGHBORHOOD. Never bypasses exact tent conflicts.
export default function SharedNeighborhoodCheckbox({ otherGroupNames = [], checked, onCheckedChange, reason, onReasonChange }) {
  return (
    <div dir="rtl" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] text-amber-800">
        <Users className="h-3.5 w-3.5 shrink-0" />
        השכונה בשימוש גם על ידי: {otherGroupNames.join(", ") || "קבוצה אחרת"}. אוהל תפוס נשאר חסום תמיד.
      </p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!checked}
          onChange={e => onCheckedChange(e.target.checked)}
          className="h-4 w-4 accent-amber-600"
        />
        <span className="text-xs font-semibold text-amber-900">אני מאשר שיתוף שכונה עם קבוצות נוספות</span>
      </label>
      {checked && (
        <Input
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          placeholder="הערה (אופציונלי)"
          className="h-7 text-xs border-amber-300 bg-white"
        />
      )}
    </div>
  );
}