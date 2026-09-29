import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * StaffGenderCounter — optional informational gender breakdown for staff.
 *
 * staffTotal is READ-ONLY and authoritative (comes from Edit Group / GuestForm).
 * maleStaff / femaleStaff are optional reference values for the Admin doing
 * manual tent allocation. They never affect staff_count, pax, meals, or any
 * other module.
 */
export default function StaffGenderCounter({ staffTotal, maleStaff, femaleStaff, onMaleChange, onFemaleChange }) {
  if (staffTotal == null) return null;

  const male   = Number(maleStaff)   || 0;
  const female = Number(femaleStaff) || 0;
  const remaining = staffTotal - male - female;
  const overAssigned = remaining < 0;
  const plusDisabled = remaining <= 0;

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-violet-700">נותרו ללא שיוך</span>
        <span className={`text-sm font-bold ${overAssigned ? "text-red-600" : "text-violet-800"}`}>{remaining}</span>
      </div>

      <CounterRow
        label="גברים"
        value={male}
        onInc={() => onMaleChange(male + 1)}
        onDec={() => onMaleChange(Math.max(male - 1, 0))}
        incDisabled={plusDisabled}
        labelColor="text-emerald-700"
      />
      <CounterRow
        label="נשים"
        value={female}
        onInc={() => onFemaleChange(female + 1)}
        onDec={() => onFemaleChange(Math.max(female - 1, 0))}
        incDisabled={plusDisabled}
        labelColor="text-orange-700"
      />

      {overAssigned && (
        <div className="text-xs font-medium pt-1.5 border-t border-violet-200 text-red-600">
          ⚠️ יש לעדכן את חלוקת הצוות לפי המגדר
        </div>
      )}
    </div>
  );
}

function CounterRow({ label, value, onInc, onDec, incDisabled, labelColor }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs font-medium ${labelColor}`}>{label}</span>
      <div className="flex items-center gap-1.5">
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={onDec} disabled={value <= 0}>
          <Minus className="w-3.5 h-3.5" />
        </Button>
        <span className="w-8 text-center text-sm font-bold text-slate-700">{value}</span>
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={onInc} disabled={incDisabled}>
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}