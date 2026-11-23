import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import CorrectionForm from "./CorrectionForm";
import { WorkerSelect } from "./ManagerFilters";

export default function ManagerAddRecord({ workers }) {
  const [open, setOpen] = useState(false);
  const [workerId, setWorkerId] = useState("");
  const close = () => { setOpen(false); setWorkerId(""); };
  if (!open) return <Button variant="outline" className="w-full" onClick={() => setOpen(true)}><Plus className="w-4 h-4" />הוספת שעות לעובד</Button>;
  return (
    <div className="rounded-2xl border border-border bg-card p-3 space-y-2">
      <WorkerSelect value={workerId} onChange={setWorkerId} workers={workers} allLabel="בחירת עובד…" />
      {workerId ? <CorrectionForm key={workerId} workerId={workerId} onDone={close} /> : <Button size="sm" variant="ghost" onClick={close}>ביטול</Button>}
    </div>
  );
}