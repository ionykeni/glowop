import { formatDateTime, periodText } from "@/lib/preventiveMaintenanceLabels";

const RESULT = {
  COMPLETED: { label: "בוצע", cls: "bg-emerald-50 text-emerald-700" },
  LATE: { label: "בוצע באיחור", cls: "bg-amber-50 text-amber-700" },
  MISSED: { label: "לא בוצע", cls: "bg-red-100 text-red-700" },
};

export default function WeeklyHistoryRow({ week }) {
  const meta = RESULT[week.result === "COMPLETED" && week.completed_late ? "LATE" : week.result];
  return (
    <div className="flex items-start justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug">{week.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          שבוע {periodText(week.period_start, week.period_end)} · אחריות: {week.responsible_label}
        </p>
        {week.result === "COMPLETED" && (
          <p className="text-[11px] text-emerald-700 mt-0.5">
            {week.completed_by_name} · {formatDateTime(week.completed_at)}
          </p>
        )}
      </div>
      <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${meta.cls}`}>{meta.label}</span>
    </div>
  );
}