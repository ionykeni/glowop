import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useActivitySpaceOptions from "@/hooks/useActivitySpaceOptions";
import { callManage, newOpId } from "@/lib/activityDayManageApi";
import EditGroupsPicker from "./EditGroupsPicker";
import EditPreviewPanel from "./EditPreviewPanel";

// Edit = check first (read-only preview on the server), then an explicit confirmation that saves in place.
export default function StationEditDialog({ execution, station, run, onClose, onMessage }) {
  const { spaces } = useActivitySpaceOptions();
  const [form, setForm] = useState({ title: station.title || "", start_time: station.start_time, end_time: station.end_time, space_id: station.space_id, group_ids: station.groups.map(g => g.group_id) });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const opId = useMemo(newOpId, []); // one id per dialog: double clicks and retries are the same operation
  const set = (patch) => { setForm(f => ({ ...f, ...patch })); setPreview(null); setError(null); };

  const check = async () => {
    setBusy("check"); setError(null);
    const r = await callManage("preview_edit", { execution_id: execution.id, station_id: station.station_id, target: form });
    setBusy(null);
    if (r.success) setPreview(r); else setError(r.error);
  };
  const save = async () => {
    setBusy("save");
    const r = await run("commit_edit", { station_id: station.station_id, target: form, op_id: opId, expected_revision: preview.revision, confirmed: true });
    setBusy(null);
    if (r.ok) {
      onMessage({ type: "ok", text: "התחנה עודכנה", warning: r.result?.post_conflict ? `שים לב: לאחר השמירה זוהתה הזמנה מקבילה בחדר — ${r.result.post_conflict}` : null });
      onClose();
    } else if (r.result?.outcome === "BLOCKED") { setPreview(p => ({ ...p, blockers: r.result.blockers || [r.message] })); }
    else { onMessage({ type: "error", text: r.message }); onClose(); }
  };
  const canSave = preview && !preview.no_changes && preview.blockers.length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="activity-day-ui activity-day-dialog max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>עריכת תחנה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>שם התחנה</Label><Input value={form.title} onChange={e => set({ title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>שעת התחלה</Label><Input type="time" value={form.start_time} onChange={e => set({ start_time: e.target.value })} /></div>
            <div><Label>שעת סיום</Label><Input type="time" value={form.end_time} onChange={e => set({ end_time: e.target.value })} /></div>
          </div>
          <div>
            <Label>חדר</Label>
            <Select value={form.space_id} onValueChange={v => set({ space_id: v })}>
              <SelectTrigger><SelectValue placeholder="בחירת חדר" /></SelectTrigger>
              <SelectContent>{spaces.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>קבוצות משתתפות</Label><EditGroupsPicker current={station.groups} dayGroups={execution.day_groups || []} selected={form.group_ids} onChange={ids => set({ group_ids: ids })} /></div>
          {error && <div className="text-sm text-red-700 bg-red-50 rounded p-2">{error}</div>}
          {preview && <EditPreviewPanel preview={preview} station={station} />}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={!!busy} onClick={onClose}>סגירה</Button>
          {!preview ? (
            <Button disabled={!!busy} onClick={check}>{busy === "check" && <Loader2 className="animate-spin" />} בדיקת השינוי</Button>
          ) : (
            <Button disabled={!canSave || !!busy} onClick={save}>{busy === "save" && <Loader2 className="animate-spin" />} אישור ושמירה</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}