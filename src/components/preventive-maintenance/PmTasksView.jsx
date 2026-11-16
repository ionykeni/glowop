import OccurrenceSection from "./OccurrenceSection";
import NeighborhoodSection from "./NeighborhoodSection";
import { periodText, monthLabel } from "@/lib/preventiveMaintenanceLabels";

export default function PmTasksView({ data, onVoid }) {
  return (
    <div className="space-y-5">
      {data.missing_current?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          טרם נוצרו משימות לתקופה הנוכחית עבור: {data.missing_current.join(", ")}. הן ייווצרו אוטומטית בריצה המתוזמנת הבאה.
        </div>
      )}
      <OccurrenceSection
        title="משימות שבועיות"
        subtitle={`שבוע ${periodText(data.week.start, data.week.end)} (ראשון–שבת)`}
        rows={data.weekly}
        onVoid={onVoid}
        empty="אין משימות שבועיות פעילות"
      />
      <OccurrenceSection
        title="משימות חודשיות"
        subtitle={monthLabel(data.month.start)}
        rows={data.monthly}
        onVoid={onVoid}
        empty="אין משימות חודשיות פעילות"
      />
      {data.intervals.map((t) => <NeighborhoodSection key={t.task_id} task={t} onVoid={onVoid} />)}
    </div>
  );
}