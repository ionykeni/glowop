import { CheckCircle2, XCircle, Clock, Ban, CircleHelp } from "lucide-react";
import { STATUS_META } from "@/lib/activityDayPlanning";

export default function PlanStatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.UNVERIFIABLE;
  const Icon = ({ AVAILABLE: CheckCircle2, BOOKED: XCircle, PENDING: Clock, UNAVAILABLE: Ban, UNVERIFIABLE: CircleHelp })[status] || CircleHelp;
  return <span className={`activity-day-status inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.cls}`}><Icon aria-hidden="true" />{meta.label}</span>;
}