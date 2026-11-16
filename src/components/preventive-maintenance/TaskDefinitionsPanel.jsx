import { useState } from "react";
import { Loader2, Pencil, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import TaskDefinitionDialog from "./TaskDefinitionDialog";
import { usePmTasks, usePmTaskMutation } from "@/hooks/usePmTaskAdmin";
import { RECURRENCE_LABELS } from "@/lib/preventiveMaintenanceLabels";

export default function TaskDefinitionsPanel() {
  const { data, isLoading, error } = usePmTasks();
  const mut = usePmTaskMutation();
  const { toast } = useToast();
  const [editing, setEditing] = useState(null);
  const tasks = data?.tasks || [];

  const toggle = (t) => {
    const activate = t.is_active === false;
    mut.mutate({ action: "set_active", id: t.id, active: activate }, {
      onSuccess: () => toast({ title: activate ? "המשימה הופעלה (מעקב מהיום)" : "המשימה הושבתה" }),
      onError: (e) => toast({ title: "השינוי לא נשמר", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">הגדרות משימות</h2>
          <p className="text-xs text-muted-foreground">שינויים חלים מהתקופה הבאה; ההיסטוריה הקיימת נשמרת כפי שהיא.</p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setEditing({})}><Plus className="w-4 h-4" /> משימה חדשה</Button>
      </div>
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
          {tasks.map((t) => (
            <div key={t.id} className={`flex items-center gap-3 px-4 py-3 ${t.is_active === false ? "opacity-60" : ""}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{t.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {RECURRENCE_LABELS[t.recurrence_type]}{t.recurrence_type === "EVERY_N_DAYS" ? ` (${t.interval_days} ימים · ${(t.units || []).length} יחידות)` : ""}
                  {" · "}{t.responsibility_type === "WORKER" ? t.responsible_name_snapshot : "תפעול"}
                  {t.is_active === false ? " · מושבתת" : ""}
                </p>
              </div>
              <button onClick={() => setEditing(t)} className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted" title="עריכה">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => toggle(t)} disabled={mut.isPending} className={`p-2 rounded-lg hover:bg-muted ${t.is_active === false ? "text-emerald-600" : "text-muted-foreground hover:text-amber-600"}`} title={t.is_active === false ? "הפעלה" : "השבתה"}>
                <Power className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <TaskDefinitionDialog task={editing} workers={data?.assignable_workers || []} onClose={() => setEditing(null)} />
    </div>
  );
}