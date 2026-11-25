import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { invokeWorkforce } from "@/lib/workforceApi";
import { israelToday, monthOf, monthTitle, shiftMonth } from "@/lib/attendanceFormat";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import PeriodNav from "./PeriodNav";
import { WorkerSelect } from "./ManagerFilters";
import PayrollWorker from "./PayrollWorker";
import PayrollSummary from "./PayrollSummary";
import { PAYROLL_METHOD, PAYROLL_NOTICE, stamp } from "./payrollPresentation";
import { printPayrollHours } from "./printPayrollHours";

export default function PayrollHoursReport() {
  const { user } = useAuth();
  const { toast } = useToast();
  const currentMonth = monthOf(israelToday());
  const [month, setMonth] = useState(currentMonth), [workerId, setWorkerId] = useState("");
  const query = useQuery({ queryKey: ["attendance", "payroll-hours", user?.id || user?.email, month, workerId],
    queryFn: () => invokeWorkforce("payrollHoursReport", { month, ...(workerId ? { worker_id: workerId } : {}) }), gcTime: 0, retry: false });
  const directory = useQuery({ queryKey: ["attendance", "payroll-directory", user?.id || user?.email],
    queryFn: () => invokeWorkforce("payrollHoursReport", { action: "directory" }), staleTime: 60_000, gcTime: 0, retry: false });
  const report = !query.isError && query.data;
  const label = monthTitle(month);
  const options = new Map([...(directory.data?.workers || []), ...(query.data?.workers_list || [])].map((w) => [w.id, w]));
  if (workerId && !options.has(workerId)) options.set(workerId, { id: workerId, full_name: "העובד שנבחר" });
  const print = () => { if (!printPayrollHours(report, label)) toast({ title: "יש לאפשר חלונות קופצים כדי לפתוח את הדוח", variant: "destructive" }); };
  return (
    <section aria-label="דוח שעות לשכר" className="space-y-4">
      <div className="att-card space-y-4 p-4 sm:p-5">
        <div><h2 className="text-xl">דוח שעות לשכר</h2><p className="mt-1 text-sm font-semibold text-sage-foreground">{PAYROLL_NOTICE}</p></div>
        <div className="grid items-center gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <PeriodNav label={label} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} nextDisabled={month >= currentMonth} />
          <WorkerSelect ariaLabel="בחירת עובד לדוח שעות לשכר" value={workerId} onChange={setWorkerId} workers={[...options.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, "he"))} allLabel="כל העובדים" />
          <Button type="button" variant="outline" className="rounded-full border-warm-line bg-sage text-sage-foreground hover:bg-sage/70 hover:text-sage-foreground" onClick={print} disabled={!report?.workers?.length || query.isFetching}>
            <FileDown />{workerId ? "PDF לעובד שנבחר" : "PDF לכל העובדים"}
          </Button>
        </div>
        {directory.isError && !query.data && <p className="text-xs text-muted-foreground" role="status">רשימת העובדים לא נטענה. <button type="button" className="underline" onClick={() => directory.refetch()}>לטעון שוב</button></p>}
        {report && <p className="text-xs text-muted-foreground">נכון ל־{stamp(report.generated_at)} · {PAYROLL_METHOD}</p>}
      </div>
      {query.isPending && <div className="flex justify-center py-10" role="status" aria-label="טוען דוח שעות לשכר"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {query.isError && <div role="alert" className="att-card flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><p>{query.error.message}</p><Button variant="outline" size="sm" onClick={() => query.refetch()}>נסו שוב</Button></div>}
      {report && !report.workers.length && <p className="att-card p-6 text-center text-sm text-muted-foreground">אין עובדים להצגה בחודש זה.</p>}
      {report && !workerId && report.workers.length > 0 && <PayrollSummary summary={report.team} title="סיכום חודשי לכל העובדים" team />}
      {report && report.workers.map((worker) => <PayrollWorker key={worker.id} worker={worker} month={label} />)}
    </section>
  );
}