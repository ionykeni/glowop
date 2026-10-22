import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";
import { buildStayDates, dayOfWeekHe, fmtDate, buildDuplicatePayload } from "@/lib/mealDuplication";
import { getOperationalStayDates } from "@/lib/groupStayPeriods";
import useGroupStayPeriods from "@/hooks/useGroupStayPeriods";

const MEAL_LABELS = { BREAKFAST: "ארוחת בוקר", LUNCH: "ארוחת צהריים", DINNER: "ארוחת ערב", OTHER: "אחר" };

// STEP: "choose" | "select" | "confirm"
export default function DuplicateMealModal({
  open, onClose, sourceMeal, arrivalDate, departureDate, group, existingMeals = [], onDone,
}) {
  const [step, setStep] = useState("choose");
  const [selectedDates, setSelectedDates] = useState([]);
  const [creating, setCreating] = useState(false);

  const mealTypeLabel = MEAL_LABELS[sourceMeal?.meal_type] || sourceMeal?.meal_type || "";
  const hasStayDates = !!arrivalDate && !!departureDate && departureDate >= arrivalDate;
  const isMultiPeriod = group?.stay_mode === "MULTI_PERIOD";
  const { periodsByGroupId } = useGroupStayPeriods(group ? [group] : []);
  const periods = isMultiPeriod && group ? (periodsByGroupId[group.id] || []) : [];
  const hasEligibleDates = isMultiPeriod ? periods.length > 0 : hasStayDates;

  // Set of dates (this group + this meal type) that already have an active meal
  const takenDates = useMemo(() => {
    const set = new Set();
    for (const m of existingMeals) {
      if (m.status !== "CANCELLED" && m.meal_type === sourceMeal?.meal_type) {
        set.add(m.date);
      }
    }
    return set;
  }, [existingMeals, sourceMeal]);

  // All stay dates except the original meal date
  // MULTI_PERIOD: only dates from ACTIVE GroupStayPeriod records (no gap dates)
  // CONTINUOUS: inclusive arrival→departure envelope (unchanged)
  const candidateDates = useMemo(() => {
    if (!sourceMeal) return [];
    let dates;
    if (isMultiPeriod) {
      if (periods.length === 0) return [];
      dates = getOperationalStayDates(periods);
    } else {
      if (!hasStayDates) return [];
      dates = buildStayDates(arrivalDate, departureDate);
    }
    return dates.filter(d => d !== sourceMeal.date);
  }, [arrivalDate, departureDate, hasStayDates, sourceMeal, isMultiPeriod, periods]);

  const availableDates = candidateDates.filter(d => !takenDates.has(d));

  const reset = () => {
    setStep("choose");
    setSelectedDates([]);
    setCreating(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const toggleDate = (d) => {
    setSelectedDates(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  // Compute the actual dates to create + skip summary based on chosen route
  const targetDates = step === "select" ? selectedDates.filter(d => !takenDates.has(d)) : availableDates;
  const skippedCount = candidateDates.filter(d => takenDates.has(d)).length;

  const handleCreate = async () => {
    if (targetDates.length === 0) return;
    setCreating(true);
    try {
      const payloads = targetDates.map(d => buildDuplicatePayload(sourceMeal, d));
      // Use individual create calls (not bulkCreate) so each record goes through
      // the standard client create path reliably from the frontend context.
      await Promise.all(payloads.map(p => opWrite.MealReservation.create(p)));
      toast.success(
        skippedCount > 0
          ? `נוצרו ${targetDates.length} ארוחות. ${skippedCount} דולגו כי כבר היו קיימות.`
          : `נוצרו ${targetDates.length} ארוחות.`
      );
      onDone?.();
      handleClose();
    } catch (err) {
      toast.error(err?.message || "יצירת הארוחות נכשלה");
      setCreating(false);
    }
  };

  if (!sourceMeal) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-4 h-4" /> להעתיק את הארוחה לתאריכים נוספים?
          </DialogTitle>
        </DialogHeader>

        {/* Missing stay dates */}
        {!hasEligibleDates ? (
          <div className="py-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3">
            חסרים תאריכי שהייה לקבוצה — לא ניתן להעתיק לכל השהייה
          </div>
        ) : step === "choose" ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              הארוחה נשמרה בהצלחה. האם להעתיק אותה ({mealTypeLabel}) לתאריכים נוספים במהלך שהיית הקבוצה?
            </p>
            <div className="space-y-2">
              <Button
                onClick={() => { if (availableDates.length) setStep("confirm"); }}
                disabled={availableDates.length === 0}
                className="w-full justify-start gap-2"
              >
                <CalendarDays className="w-4 h-4" />
                כן, לכל תאריכי השהייה
                {availableDates.length > 0 && <span className="text-xs opacity-80">({availableDates.length})</span>}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setSelectedDates(availableDates); setStep("select"); }}
                disabled={candidateDates.length === 0}
                className="w-full justify-start gap-2"
              >
                <Check className="w-4 h-4" /> בחירת תאריכים
              </Button>
              <Button variant="ghost" onClick={handleClose} className="w-full justify-start gap-2 text-slate-500">
                <X className="w-4 h-4" /> לא, רק התאריך הזה
              </Button>
            </div>
            {availableDates.length === 0 && candidateDates.length > 0 && (
              <p className="text-xs text-slate-400">כל תאריכי השהייה כבר כוללים {mealTypeLabel}.</p>
            )}
          </div>
        ) : step === "select" ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">בחר תאריכים להעתקת {mealTypeLabel}:</p>
            <div className="max-h-64 overflow-y-auto space-y-1.5 border border-slate-100 rounded-lg p-2">
              {candidateDates.map(d => {
                const taken = takenDates.has(d);
                const checked = selectedDates.includes(d);
                return (
                  <label
                    key={d}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${taken ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50"}`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary"
                      disabled={taken}
                      checked={!taken && checked}
                      onChange={() => !taken && toggleDate(d)}
                    />
                    <span className="font-medium">{fmtDate(d)}</span>
                    <span className="text-xs text-slate-400">· יום {dayOfWeekHe(d)}</span>
                    {taken && <span className="text-xs text-amber-600 mr-auto">כבר קיימת {mealTypeLabel}</span>}
                  </label>
                );
              })}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("choose")}>חזרה</Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={creating || targetDates.length === 0}
              >
                {creating ? "יוצר..." : targetDates.length === 0 ? "לא נבחרו תאריכים" : `צור ${targetDates.length} ארוחות`}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          // confirm (all dates)
          <div className="space-y-3">
            <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
              <p>ייווצרו <span className="font-bold">{targetDates.length}</span> ארוחות חדשות ({mealTypeLabel}).</p>
              {skippedCount > 0 && (
                <p className="text-amber-700">
                  {skippedCount} תאריכים כבר כוללים {mealTypeLabel} ולכן ידולגו.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("choose")}>חזרה</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || targetDates.length === 0}>
                {creating ? "יוצר..." : "צור ארוחות"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}