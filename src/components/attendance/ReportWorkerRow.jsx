import { useId, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import WorkerComparison from "./WorkerComparison";
import { workerSummary } from "./attendanceReportPresentation";

const diffTone = (v) => (v.startsWith("+") ? "text-emerald-700" : v.startsWith("−") ? "text-red-600" : "");

export default function ReportWorkerRow({ worker, generatedAt }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const [name, ...numbers] = workerSummary(worker, generatedAt);
  return (
    <>
      <tr className={`border-t border-warm-line/60 transition-colors duration-150 ${open ? "bg-sage/40" : "hover:bg-cream/80"}`}>
        <th scope="row" className="p-0 font-semibold">
          <button type="button" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-2 px-3 py-3.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:px-5">
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            <span className="break-words">{name}</span>
          </button>
        </th>
        {numbers.map((value, index) => (
          <td key={index} className={`px-1 py-3.5 text-center tabular-nums sm:px-4 ${index === numbers.length - 1 ? `font-semibold ${diffTone(String(value))}` : ""}`}><bdi dir="ltr">{value}</bdi></td>
        ))}
      </tr>
      {open && (
        <tr id={detailId} className="bg-sage/40">
          <td colSpan={5} className="px-2 pb-4 sm:px-5">
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <WorkerComparison worker={worker} />
            </motion.div>
          </td>
        </tr>
      )}
    </>
  );
}