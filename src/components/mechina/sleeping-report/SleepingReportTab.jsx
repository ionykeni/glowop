import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, Send, Loader2 } from "lucide-react";
import ReportSummaryBar from "./ReportSummaryBar";
import NeighborhoodTentPicker from "./NeighborhoodTentPicker";
import TentEntryEditor from "./TentEntryEditor";
import AddExceptionTent from "./AddExceptionTent";
import VersionHistoryList from "./VersionHistoryList";
import { computeTotals, entryWarnings, formatPeriod, formatDateTime } from "@/lib/mechinaSleepingReportCalc";
import { generateAndAttachPdf } from "@/lib/mechinaSleepingReportPdf";

const call = async (payload) => {
  const res = await base44.functions.invoke("mechinaSleepingReport", payload);
  if (!res.data?.success) throw new Error(res.data?.error || "שגיאה");
  return res.data;
};

export default function SleepingReportTab({ groupId }) {
  const [periodKey, setPeriodKey] = useState("");
  const [ctx, setCtx] = useState(null);
  const [entries, setEntries] = useState({});   // tent_id -> {boys, girls, note}
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState("");

  const load = async (pk) => {
    const data = await call({ action: "context", group_id: groupId, period_key: pk || undefined });
    setCtx(data);
    setPeriodKey(data.period.key);
    const source = data.draft?.entries || data.latest_entries || data.assigned_tent_ids.map(id => ({ tent_id: id, boys: 0, girls: 0 }));
    const map = Object.fromEntries(data.assigned_tent_ids.map(id => [id, { boys: 0, girls: 0, note: "" }]));
    for (const e of source) map[e.tent_id] = { boys: e.boys || 0, girls: e.girls || 0, note: e.note || "" };
    setEntries(map);
    setNotes(data.draft?.general_notes ?? data.latest_notes ?? "");
    setSelected("");
  };

  useEffect(() => {
    if (!groupId) return;
    setCtx(null);
    load("").catch(e => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const tentMap = useMemo(() => Object.fromEntries((ctx?.tents || []).map(t => [t.id, t])), [ctx]);
  const assignedSet = useMemo(() => new Set(ctx?.assigned_tent_ids || []), [ctx]);
  const shownTents = Object.keys(entries).map(id => tentMap[id]).filter(Boolean);
  const neighborhoods = [...(ctx?.neighborhoods || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const entryList = Object.entries(entries).map(([tent_id, e]) => ({ tent_id, ...e }));
  const totals = computeTotals(entryList);
  const warningCount = entryList.reduce((n, e) => n + entryWarnings(e, tentMap[e.tent_id], assignedSet.has(e.tent_id)).length, 0);

  if (!groupId) return <p className="text-sm text-muted-foreground">לא נמצאה מכינה מקושרת.</p>;
  if (!ctx) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const saveDraft = async () => {
    setBusy("draft");
    try { await call({ action: "save_draft", group_id: groupId, period_key: periodKey, entries: entryList, general_notes: notes }); toast.success("הטיוטה נשמרה"); }
    catch (e) { toast.error(e.message); }
    setBusy("");
  };

  const finishPdf = async (version) => {
    await generateAndAttachPdf(version);
    toast.success(`גרסה ${version.version_number} הוגשה וה-PDF נשמר`);
    await load(periodKey);
  };

  const submit = async () => {
    if (!window.confirm(`להגיש גרסה רשמית עם ${totals.total} חניכים${warningCount ? ` (${warningCount} אזהרות)` : ""}? גרסה שהוגשה לא ניתנת לשינוי — תיקון ייצור גרסה חדשה.`)) return;
    setBusy("submit");
    try {
      const { version } = await call({ action: "submit", group_id: groupId, period_key: periodKey, entries: entryList, general_notes: notes });
      await finishPdf(version);
    } catch (e) {
      toast.error(`ההגשה לא הושלמה: ${e.message}`);
      await load(periodKey).catch(() => {});
    }
    setBusy("");
  };

  const retryPdf = async (v) => {
    setBusy("submit");
    try { const { version } = await call({ action: "version_detail", version_id: v.id }); await finishPdf(version); }
    catch (e) { toast.error(e.message); }
    setBusy("");
  };

  const sel = selected && tentMap[selected];

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl px-4 py-3 space-y-2">
        <p className="text-sm"><span className="text-muted-foreground">מכינה: </span><span className="font-semibold">{ctx.group.group_name}</span></p>
        {ctx.periods.length > 1 ? (
          <select value={periodKey} onChange={e => load(e.target.value)} className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-background">
            {ctx.periods.map(p => <option key={p.key} value={p.key}>תקופת שהייה: {formatPeriod(p)}</option>)}
          </select>
        ) : (
          <p className="text-sm"><span className="text-muted-foreground">תקופת שהייה: </span>{formatPeriod(ctx.period)}</p>
        )}
        {ctx.draft && <p className="text-xs text-amber-700">טיוטה שמורה מ-{formatDateTime(ctx.draft.updated_at)}</p>}
      </div>

      <ReportSummaryBar expected={ctx.expected_students} totals={totals} />

      {sel && (
        <TentEntryEditor tent={sel} entry={entries[selected]} assigned={assignedSet.has(selected)}
          onChange={e => setEntries(m => ({ ...m, [selected]: e }))}
          onRemove={() => { setEntries(m => { const n = { ...m }; delete n[selected]; return n; }); setSelected(""); }}
          onClose={() => setSelected("")} />
      )}

      {shownTents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-xl">אין אוהלים משובצים לקבוצה בתקופה זו</p>
      ) : (
        <NeighborhoodTentPicker neighborhoods={neighborhoods} tents={shownTents} entries={entries}
          assignedSet={assignedSet} selectedTentId={selected} onSelect={id => { setSelected(id); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      )}

      <AddExceptionTent tents={ctx.tents} neighborhoods={neighborhoods} excludeIds={new Set(Object.keys(entries))}
        onAdd={id => { setEntries(m => ({ ...m, [id]: { boys: 0, girls: 0, note: "" } })); setSelected(id); }} />

      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="הערות כלליות לדיווח (אופציונלי)"
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />

      <div className="flex gap-2 sticky bottom-2">
        <Button variant="outline" className="flex-1 gap-1.5 bg-card" disabled={!!busy} onClick={saveDraft}>
          {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} שמור טיוטה
        </Button>
        <Button className="flex-1 gap-1.5" disabled={!!busy} onClick={submit}>
          {busy === "submit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {ctx.versions.some(v => v.status === "SUBMITTED") ? "הגש גרסה מתוקנת" : "הגש דיווח"}
        </Button>
      </div>

      <VersionHistoryList versions={ctx.versions} onRetryPdf={retryPdf} />
    </div>
  );
}