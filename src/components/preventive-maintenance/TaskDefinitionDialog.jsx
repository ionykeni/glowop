import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import UnitsEditor from "./UnitsEditor";
import { usePmTaskMutation } from "@/hooks/usePmTaskAdmin";
import { RECURRENCE_LABELS } from "@/lib/preventiveMaintenanceLabels";

const select = "h-10 w-full rounded-md border border-input bg-card px-2 text-sm disabled:opacity-60";
const blank = { title: "", area_label: "", category: "", recurrence_type: "WEEKLY", responsibility_type: "OPERATIONS_TEAM", responsible_worker_id: "", display_order: 100, interval_days: 30, warning_days: 21, units: [] };

function Row({ label, children }) {
  return <label className="block space-y-1"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{children}</label>;
}

export default function TaskDefinitionDialog({ task, workers, onClose }) {
  const [form, setForm] = useState(blank);
  const mut = usePmTaskMutation();
  const { toast } = useToast();
  const isEdit = !!task?.id;

  useEffect(() => { if (task) { setForm({ ...blank, ...task, responsible_worker_id: task.responsible_worker_id || "", units: task.units || [] }); mut.reset(); } }, [task]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const responsibility = form.responsibility_type === "WORKER" ? form.responsible_worker_id : "TEAM";
  const setResponsibility = (v) => setForm((f) => ({ ...f, responsibility_type: v === "TEAM" ? "OPERATIONS_TEAM" : "WORKER", responsible_worker_id: v === "TEAM" ? "" : v }));

  const save = () => {
    const payload = {
      title: form.title, area_label: form.area_label, category: form.category, recurrence_type: form.recurrence_type,
      responsibility_type: form.responsibility_type, responsible_worker_id: form.responsible_worker_id || null,
      display_order: Number(form.display_order), interval_days: Number(form.interval_days), warning_days: Number(form.warning_days),
      units: form.units.map((u) => ({ unit_key: u.unit_key, label: u.label })),
    };
    mut.mutate({ action: "save", id: task?.id, task: payload }, { onSuccess: () => { toast({ title: isEdit ? "המשימה עודכנה" : "המשימה נוספה" }); onClose(); } });
  };

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-right">{isEdit ? "עריכת משימה" : "משימה חדשה"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Row label="שם המשימה"><Input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={120} /></Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label="אזור"><Input value={form.area_label || ""} onChange={(e) => set("area_label", e.target.value)} maxLength={120} /></Row>
            <Row label="קטגוריה"><Input value={form.category || ""} onChange={(e) => set("category", e.target.value)} maxLength={60} /></Row>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Row label="חזרתיות">
              <select className={select} value={form.recurrence_type} disabled={isEdit} onChange={(e) => set("recurrence_type", e.target.value)}>
                {Object.entries(RECURRENCE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Row>
            <Row label="אחריות">
              <select className={select} value={responsibility} onChange={(e) => setResponsibility(e.target.value)}>
                <option value="TEAM">צוות תפעול</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Row>
          </div>
          {form.recurrence_type === "EVERY_N_DAYS" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Row label="מרווח מקסימלי (ימים)"><Input type="number" min={1} max={365} value={form.interval_days} onChange={(e) => set("interval_days", e.target.value)} /></Row>
                <Row label="התרעה החל מיום"><Input type="number" min={1} value={form.warning_days} onChange={(e) => set("warning_days", e.target.value)} /></Row>
              </div>
              <UnitsEditor units={form.units} onChange={(u) => set("units", u)} />
            </>
          )}
          <Row label="סדר תצוגה"><Input type="number" value={form.display_order} onChange={(e) => set("display_order", e.target.value)} /></Row>
          {isEdit && <p className="text-[11px] text-muted-foreground">השינוי חל על תקופות עתידיות. משימות שכבר נוצרו וההיסטוריה אינן משתנות.</p>}
          {mut.error && <p className="text-xs text-red-600">{mut.error.message}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={save} disabled={mut.isPending || !form.title.trim()}>{mut.isPending ? "שומר..." : "שמירה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}