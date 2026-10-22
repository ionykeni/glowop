/**
 * MealSyncAfterDateChangeModal
 * Shown after admin edits a group with a shorter stay and out-of-range active meals exist.
 * Allows admin to cancel out-of-range meals or dismiss and leave them.
 */
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function MealSyncAfterDateChangeModal({ groupId, outOfRangeMeals, newDeparture, onClose }) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await Promise.all(
        outOfRangeMeals.map(m =>
          opWrite.MealReservation.update(m.id, { status: "CANCELLED" })
        )
      );
      toast.success(`${outOfRangeMeals.length} ארוחות בוטלו בהצלחה`);
      queryClient.invalidateQueries({ queryKey: ["meals_out_of_range"] });
      queryClient.invalidateQueries({ queryKey: ["meal_reservations"] });
      queryClient.invalidateQueries({ queryKey: ["meals"] });
      onClose();
    } catch (err) {
      toast.error("שגיאה בביטול הארוחות");
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDismiss = () => {
    toast.warning("הארוחות מחוץ לטווח נשארו פעילות — ניתן לבטל אותן מדף הקבוצה", { duration: 5000 });
    onClose();
  };

  return (
    <Dialog open onOpenChange={handleDismiss}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-5 h-5" />
            התאריכים של הקבוצה השתנו
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-foreground">
            נמצאו <strong>{outOfRangeMeals.length} ארוחות פעילות</strong> מחוץ לטווח התאריכים החדש
            (לאחר {newDeparture}).
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 max-h-40 overflow-y-auto space-y-0.5">
            {outOfRangeMeals.map(m => (
              <div key={m.id}>{m.date} — {m.meal_type}</div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">האם לבטל אותן?</p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={handleDismiss} disabled={syncing}>
            השאר כרגע
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "מבטל..." : "סנכרן ארוחות לפי התאריכים החדשים"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}