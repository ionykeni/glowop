import NeighborhoodCard from "./NeighborhoodCard";
import { usePmCompleteAction } from "@/hooks/usePreventiveMaintenance";

export default function NeighborhoodSection({ task, onVoid }) {
  const { run, busyKey } = usePmCompleteAction();
  const due = task.units.filter((u) => u.state === "DUE" || u.state === "NO_RECORD").length;

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/40">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{task.title}</h2>
          <p className="text-xs text-muted-foreground">
            כל יחידה לפחות פעם ב-{task.interval_days} ימים, בכל סדר · אחריות: {task.responsible_label}
          </p>
        </div>
        {due > 0 && <span className="text-xs font-semibold bg-red-100 text-red-700 rounded-full px-2.5 py-1 shrink-0">{due} דורשות ניקוי</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
        {task.units.map((u) => (
          <NeighborhoodCard
            key={u.unit_key}
            unit={u}
            canComplete={task.can_complete}
            busy={busyKey === u.unit_key}
            onClean={() => run(u.unit_key, { task_id: task.task_id, unit_key: u.unit_key })}
            onVoid={() => onVoid({ event_id: u.last_event_id, title: `${task.title} — ${u.label}` })}
          />
        ))}
      </div>
      <p className="px-4 pb-3 text-[11px] text-muted-foreground">
        0–{task.warning_days - 1} ימים תקין · {task.warning_days}–{task.interval_days - 1} מתקרב · {task.interval_days}+ נדרש ניקוי
      </p>
    </section>
  );
}