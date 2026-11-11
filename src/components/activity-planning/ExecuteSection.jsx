import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarPlus } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { HARD_STATUSES } from "@/lib/activityDayExecution";
import ExecuteConfirmDialog from "./ExecuteConfirmDialog";

const EXECUTE_ROLES = ["ADMIN", "SUPER_ADMIN"];

// Final step of the planner: explicit confirmation, then one backend call that creates the activities.
export default function ExecuteSection({ plan, exec }) {
  const { role } = useRole();
  const [open, setOpen] = useState(false);
  const { preview, previewStale, template } = plan;
  if (!EXECUTE_ROLES.includes(role)) return null;
  const hard = preview ? preview.stations.filter(s => HARD_STATUSES.includes(s.status)) : [];
  const ready = !!preview && !previewStale && !preview.template_changed && hard.length === 0;
  const p = exec.problem;

  const confirm = () => {
    setOpen(false);
    exec.execute({ template_id: template.id, template_updated_date: template.updated_date, date: preview.date, stations: plan.payloadStations });
  };

  return (
    <section className="activity-day-section activity-day-commit space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <h2 className="text-sm font-bold text-slate-500 flex-1">ה. יצירת הפעילויות</h2>
        <Button onClick={() => setOpen(true)} disabled={!ready || exec.running} className="gap-1.5">
          {exec.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />} צור פעילויות ושמור
        </Button>
      </div>
      {!preview && <p className="text-xs text-slate-500">יש להריץ בדיקת זמינות לפני היצירה.</p>}
      {preview && previewStale && <p className="text-xs text-slate-500">התוכנית שונתה — יש לבדוק שוב לפני היצירה.</p>}
      {preview && !previewStale && hard.length > 0 && <p className="text-xs text-red-700">לא ניתן ליצור: {hard.length} תחנות עם התנגשות או נתון חסר.</p>}
      {p && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1">
          <p className="font-semibold">{p.error}</p>
          {(p.blockers || []).map(b => <p key={b.station_id}>{b.start_time}–{b.end_time} · {b.title || "ללא שם"} · {b.space_name || "—"}: {b.reasons.join(" · ")}</p>)}
          {p.outcome === "UNKNOWN" && <Button size="sm" variant="outline" onClick={() => exec.checkStatus()} disabled={exec.checking}>בדוק מצב ביצוע</Button>}
        </div>
      )}
      <ExecuteConfirmDialog open={open} onOpenChange={setOpen} preview={preview} onConfirm={confirm} />
    </section>
  );
}