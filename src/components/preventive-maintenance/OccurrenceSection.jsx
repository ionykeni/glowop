import OccurrenceRow from "./OccurrenceRow";
import { usePmCompleteAction } from "@/hooks/usePreventiveMaintenance";

export default function OccurrenceSection({ title, subtitle, rows, onVoid, empty }) {
  const { run, busyKey } = usePmCompleteAction();
  const current = rows.filter((r) => r.state !== "OVERDUE");
  const done = current.filter((r) => r.state === "COMPLETED").length;
  const overdue = rows.length - current.length;

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/40">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {overdue > 0 && <span className="text-xs font-semibold bg-red-100 text-red-700 rounded-full px-2.5 py-1">{overdue} באיחור</span>}
          {current.length > 0 && <span className="text-xs font-semibold bg-primary/10 text-primary rounded-full px-2.5 py-1">{done}/{current.length} בוצעו</span>}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-center text-muted-foreground">{empty}</p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <OccurrenceRow
              key={r.id}
              row={r}
              busy={busyKey === r.id}
              onComplete={() => run(r.id, { occurrence_id: r.id })}
              onVoid={() => onVoid({ event_id: r.completion_event_id, title: r.title })}
            />
          ))}
        </div>
      )}
    </section>
  );
}