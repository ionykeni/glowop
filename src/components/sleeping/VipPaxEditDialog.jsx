import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BedDouble, AlertTriangle, Unlock } from "lucide-react";
import { toast } from "sonner";
import { upsertReviewAlert } from "@/lib/reviewAlerts";

/**
 * Minimal dialog to edit allocated_pax on an already-confirmed VIP allocation.
 * Status stays CONFIRMED. Creates a HOUSEKEEPING review alert after save.
 */
export default function VipPaxEditDialog({
  allocation,       // SleepingAllocation row (CONFIRMED)
  tent,             // Tent record
  totalRequestedVipPax,  // sum of people_count from vip_tent_requirements_json (for overbooking check)
  totalAllocatedVipPax,  // sum of allocated_pax from ALL active confirmed VIP allocs for this group
  groupId,
  onSaved,
  onClose,
}) {
  const VIP_OPERATIONAL_MAX_PAX = 4;
  const maxPax = VIP_OPERATIONAL_MAX_PAX;
  const [pax, setPax] = useState(allocation?.allocated_pax ?? 1);
  const [notes, setNotes] = useState((allocation?.notes || "").replace(/__vip_req_\d+__\s*/g, "").trim());
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState(null);

  // Live overbooking check: current total minus this allocation's current pax + new pax
  const otherVipPax = (totalAllocatedVipPax || 0) - (allocation?.allocated_pax || 0);
  const newTotal    = otherVipPax + pax;
  const isOverbooking = totalRequestedVipPax != null && newTotal > totalRequestedVipPax;

  const validate = () => {
    if (pax < 1) return "מספר האנשים חייב להיות לפחות 1";
    if (pax > maxPax) return `מקסימום ${maxPax} אנשים לאוהל זה`;
    if (isOverbooking) return `שובצו יותר אנשים ממה שנדרש (מקסימום ${totalRequestedVipPax} VIP)`;
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setSaving(true);

    try {
      // Preserve the __vip_req_N__ marker in notes
      const marker = (allocation.notes || "").match(/__vip_req_\d+__/)?.[0] || "";
      const cleanNotes = notes.trim();
      const updatedNotes = marker
        ? `${marker}${cleanNotes ? " " + cleanNotes : ""}`.trim()
        : cleanNotes;

      // Update the allocation row directly — keep status CONFIRMED
      await opWrite.SleepingAllocation.update(allocation.id, {
        allocated_pax: pax,
        notes: updatedNotes,
        // status stays CONFIRMED — do not change it
      });

      // Create housekeeping review alert
      try {
        await upsertReviewAlert(
          groupId,
          "HOUSEKEEPING",
          "ALLOCATION_CHANGED",
          "שיבוץ VIP השתנה",
          `שיבוץ ה-VIP של הקבוצה השתנה לאחר אישור (אוהל ${tent?.code} — ${allocation.allocated_pax} → ${pax} אנשים). יש לבדוק הכנות משק בית.`,
          { tent_code: tent?.code, old_pax: allocation.allocated_pax },
          { tent_code: tent?.code, new_pax: pax }
        );
      } catch (alertErr) {
        console.warn("[VipPaxEditDialog] alert creation failed:", alertErr?.message);
      }

      toast.success(`כמות ה-VIP עודכנה — אוהל ${tent?.code}: ${pax} אנשים ✓`);
      onSaved();
    } catch (err) {
      console.error("[VipPaxEditDialog] save error:", err);
      setError(err?.message || "שגיאה בשמירה — נסה שוב");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xs" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-base flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-primary" />
            עריכת כמות VIP
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tent info */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <BedDouble className="w-5 h-5 text-slate-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-800">אוהל {tent?.code}</p>
              <p className="text-xs text-slate-400">קיבולת: {tent?.capacity} מיטות · מקסימום תפעולי: {maxPax}</p>
            </div>
            <div className="mr-auto text-center">
              <p className="text-xs text-slate-400">נוכחי</p>
              <p className="text-xl font-bold text-slate-700">{allocation?.allocated_pax}</p>
            </div>
          </div>

          {/* Pax stepper */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">
              מספר אנשים חדש
              <span className="text-slate-400 font-normal mr-1">(1–{maxPax})</span>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPax(p => Math.max(1, p - 1))}
                className="w-10 h-10 rounded-lg border border-slate-200 bg-white text-slate-600 text-xl font-bold hover:bg-slate-50 transition-colors flex items-center justify-center"
              >−</button>
              <span className="text-3xl font-bold text-slate-700 min-w-[36px] text-center">{pax}</span>
              <button
                type="button"
                onClick={() => setPax(p => Math.min(maxPax, p + 1))}
                className="w-10 h-10 rounded-lg border border-slate-200 bg-white text-slate-600 text-xl font-bold hover:bg-slate-50 transition-colors flex items-center justify-center"
              >+</button>
              <div className="flex gap-1 mr-1">
                {[1,2,3,4].map(n => (
                  <span key={n} className={`w-3 h-3 rounded-full transition-colors ${n <= pax ? "bg-primary/70" : "bg-slate-200"}`} />
                ))}
              </div>
            </div>
          </div>

          {/* Overbooking warning */}
          {isOverbooking && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              שובצו יותר אנשים ממה שנדרש ({newTotal} מתוך {totalRequestedVipPax} מבוקשים)
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">הערות <span className="text-slate-400 font-normal">(אופציונלי)</span></label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="הערות לאוהל..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={releasing || saving}
              onClick={async () => {
                if (!window.confirm(`לשחרר את אוהל ${tent?.code}?`)) return;
                setReleasing(true);
                setError(null);
                try {
                  await opWrite.SleepingAllocation.update(allocation.id, { status: "CANCELLED" });
                  toast.success(`אוהל ${tent?.code} שוחרר`);
                  onSaved();
                } catch (err) {
                  setError(err?.message || "שגיאה בשחרור — נסה שוב");
                } finally {
                  setReleasing(false);
                }
              }}
              className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
            >
              <Unlock className="w-3.5 h-3.5" />
              {releasing ? "משחרר..." : "שחרר אוהל"}
            </Button>
            <div className="flex-1" />
            <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={saving || releasing}>
              ביטול
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || releasing || isOverbooking}
              className="bg-primary hover:bg-primary/90"
            >
              {saving ? "שומר..." : "שמור שינוי"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}