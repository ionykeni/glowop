import { STATUS_META } from "@/lib/attendanceFormat";

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.NORMAL;
  return <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${meta.cls}`}>{meta.label}</span>;
}