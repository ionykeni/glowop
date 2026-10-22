/**
 * MealDateRangeWarning
 * Shows a warning when active MealReservation records exist outside the group's current stay dates.
 * Provides a button to cancel them (set to CANCELLED).
 * Used in GroupDetail overview tab.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

export default function MealDateRangeWarning({ group }) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data: outOfRangeMeals = [], isLoading } = useQuery({
    queryKey: ["meals_out_of_range", group?.id, group?.arrival_date, group?.departure_date],
    queryFn: async () => {
      if (!group?.id) return [];
      const all = await base44.entities.MealReservation.filter({ group_id: group.id });
      const arrival    = group.arrival_date;
      const departure  = group.departure_date;
      return all.filter(m => {
        if (m.status === "CANCELLED") return false;
        if (arrival    && m.date < arrival)    return true;
        if (departure  && m.date > departure)  return true;
        return false;
      });
    },
    enabled: !!group?.id && !!group?.departure_date,
    staleTime: 30_000,
  });

  if (isLoading || dismissed || outOfRangeMeals.length === 0) return null;

  const handleCancel = async () => {
    setCancelling(true);
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
      setDismissed(true);
    } catch (err) {
      toast.error("שגיאה בביטול הארוחות");
      console.error(err);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">יש ארוחות פעילות מחוץ לתאריכי השהות של הקבוצה</p>
          <p className="text-xs text-amber-700 mt-0.5">
            נמצאו {outOfRangeMeals.length} ארוחות פעילות מחוץ לטווח{" "}
            {group.arrival_date} – {group.departure_date}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="border-amber-400 text-amber-800 hover:bg-amber-100"
          onClick={handleCancel}
          disabled={cancelling}
        >
          {cancelling ? "מבטל..." : "בטל ארוחות מחוץ לטווח"}
        </Button>
        <button onClick={() => setDismissed(true)} className="text-amber-400 hover:text-amber-600">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}