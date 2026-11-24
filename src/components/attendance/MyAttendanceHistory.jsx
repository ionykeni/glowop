import { useState } from "react";
import { Plus, Loader2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import PeriodNav from "./PeriodNav";
import TotalsChips from "./TotalsChips";
import AttendanceRow from "./AttendanceRow";
import CorrectionForm from "./CorrectionForm";
import MyRequestsList from "./MyRequestsList";
import { useMyMonth } from "@/hooks/useAttendance";
import { israelToday, monthOf, shiftMonth, monthTitle } from "@/lib/attendanceFormat";

export default function MyAttendanceHistory() {
  const current = monthOf(israelToday());
  const [month, setMonth] = useState(current);
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isFetching, error } = useMyMonth(month);
  const records = data?.records || [];

  return (
    <div className="space-y-3">
      <PeriodNav label={monthTitle(month)} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} nextDisabled={month >= current} />
      <TotalsChips totals={data?.totals} />
      <Button variant="outline" className="w-full h-11 rounded-2xl border-dashed border-warm-line bg-card hover:bg-sage hover:text-sage-foreground" onClick={() => setAdding((v) => !v)}><Plus className="w-4 h-4" />הוספת שעות שנשכחו</Button>
      {adding && <CorrectionForm onDone={() => setAdding(false)} />}
      <MyRequestsList />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-warm-line bg-card/60 py-10 text-center text-sm text-muted-foreground">
          <History className="w-7 h-7 mx-auto mb-2 opacity-30" />אין רשומות נוכחות בחודש זה
        </div>
      ) : (
        <div className={`att-card att-divide overflow-hidden transition-opacity ${isFetching ? "opacity-60" : ""}`}>
          {records.map((r) => <AttendanceRow key={r.id} record={r} />)}
        </div>
      )}
    </div>
  );
}