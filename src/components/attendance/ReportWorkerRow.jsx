import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import WorkerComparison from "./WorkerComparison";
import { workerSummary } from "./attendanceReportPresentation";

export default function ReportWorkerRow({ worker, generatedAt }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const [name, ...numbers] = workerSummary(worker, generatedAt);
  return (
    <>
      <tr className="border-t border-border hover:bg-muted/25">
        <th scope="row" className="p-0 font-semibold">
          <button type="button" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-2 py-3 text-start sm:gap-2 sm:px-4">
            <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`} />
            <span className="break-words">{name}</span>
          </button>
        </th>
        {numbers.map((value, index) => <td key={index} className="px-1 py-3 text-center tabular-nums sm:px-4"><bdi dir="ltr">{value}</bdi></td>)}
      </tr>
      {open && <tr id={detailId} className="border-t border-border bg-muted/25"><td colSpan={5} className="px-2 py-4 sm:px-4"><WorkerComparison worker={worker} /></td></tr>}
    </>
  );
}