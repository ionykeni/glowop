import { REQUEST_STATUS_META } from "@/lib/attendanceFormat";

export default function RequestStatusBadge({ status }) {
  const meta = REQUEST_STATUS_META[status] || REQUEST_STATUS_META.PENDING;
  return <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${meta.cls}`}>{meta.label}</span>;
}