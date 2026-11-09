import { STATUS_META } from "@/lib/activityDayPlanning";

export default function PlanStatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.UNVERIFIABLE;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>;
}