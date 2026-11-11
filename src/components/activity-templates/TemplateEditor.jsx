import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Save, CheckCircle2, Loader2 } from "lucide-react";
import { callTemplates, newStation } from "@/lib/activityDayTemplatesApi";
import StationEditorCard from "./StationEditorCard";
import MarkReadyDialog from "./MarkReadyDialog";
import TemplateMessages from "./TemplateMessages";

const toEditable = (s) => ({ ...newStation(), ...s, chairs_count: s.chairs_count ?? "" });

export default function TemplateEditor({ template, spaces, onSaved }) {
  const [current, setCurrent] = useState(template); // latest persisted record (for stale checks)
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [stations, setStations] = useState(() => (template?.stations || []).map(toEditable));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const updateStation = (i, patch) => setStations(p => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveStation = (i, d) => setStations(p => { const n = [...p]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const removeStation = (i) => setStations(p => p.filter((_, j) => j !== i));

  const fail = (res) => { setErrors(res.errors || [{ message: res.error }]); setNotice(""); };

  const save = async () => {
    setBusy(true); setErrors([]); setNotice("");
    const payload = { name, description, stations };
    const res = current
      ? await callTemplates("save_draft", { id: current.id, expected_updated_date: current.updated_date, ...payload })
      : await callTemplates("create", payload);
    setBusy(false);
    if (!res.success) { fail(res); return null; }
    setCurrent(res.template); setWarnings(res.warnings || []); setNotice("הטיוטה נשמרה");
    onSaved(res.template);
    return res.template;
  };

  const markReady = async () => {
    setConfirmOpen(false);
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    const res = await callTemplates("mark_ready", { id: saved.id, expected_updated_date: saved.updated_date, confirm: true });
    setBusy(false);
    if (!res.success) return fail(res);
    onSaved(res.template);
  };

  const generalErrors = errors.filter(e => e.station_index === undefined);
  return (
    <div className="space-y-4">
      <div className="activity-day-section space-y-4">
        <div className="space-y-1"><label className="text-xs text-slate-500">שם התבנית *</label><Input value={name} onChange={e => setName(e.target.value)} placeholder="לדוגמה: כאן על פני האדמה" /></div>
        <div className="space-y-1"><label className="text-xs text-slate-500">תיאור</label><Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></div>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">תחנות ({stations.length})</h2>
        <p className="text-[11px] text-slate-400">תחנות יכולות לפעול במקביל</p>
      </div>
      {stations.map((s, i) => (
        <StationEditorCard key={s.station_id} station={s} index={i} total={stations.length} spaces={spaces}
          errors={errors.filter(e => e.station_index === i)}
          onChange={patch => updateStation(i, patch)} onMove={d => moveStation(i, d)} onRemove={() => removeStation(i)} />
      ))}
      <Button type="button" variant="outline" onClick={() => setStations(p => [...p, newStation()])} className="w-full border-dashed gap-1.5"><Plus className="w-4 h-4" /> הוסף תחנה</Button>
      <TemplateMessages errors={generalErrors} warnings={warnings} notice={notice} />
      <div className="activity-day-savebar flex flex-col sm:flex-row gap-2 sticky bottom-0 py-3">
        <Button onClick={save} disabled={busy} variant="outline" className="gap-1.5 flex-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} שמור טיוטה
        </Button>
        <Button onClick={() => setConfirmOpen(true)} disabled={busy || stations.length === 0} className="gap-1.5 flex-1">
          <CheckCircle2 className="w-4 h-4" /> סמן כמוכנה
        </Button>
      </div>
      <MarkReadyDialog open={confirmOpen} onOpenChange={setConfirmOpen} stationCount={stations.length} onConfirm={markReady} />
    </div>
  );
}