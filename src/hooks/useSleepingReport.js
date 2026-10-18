import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { normalizeEntry, computeTotals, entryWarnings } from "@/lib/mechinaSleepingReportCalc";
import { generateAndAttachPdf } from "@/lib/mechinaSleepingReportPdf";
const call = async payload => {
  const r = await base44.functions.invoke("mechinaSleepingReport", payload);
  if (!r.data?.success) throw new Error(r.data?.error || "שגיאה");
  return r.data;
};
export default function useSleepingReport(groupId) {
  const [ctx, setCtx] = useState(null), [entries, setEntries] = useState({});
  const [notes, setNotes] = useState(""), [busy, setBusy] = useState("");
  const [error, setError] = useState(""), [selected, setSelected] = useState("");
  const load = async (periodKey = "") => {
    setBusy("load"); setError(""); setSelected("");
    try {
      const data = await call({ action: "context", group_id: groupId, period_key: periodKey || undefined });
      const allowed = new Set(data.tents.map(t => t.id));
      const source = data.draft?.entries || data.latest_entries || [];
      setEntries(Object.fromEntries(source.filter(e => allowed.has(e.tent_id)).map(e => [e.tent_id, normalizeEntry(e)])));
      setNotes(data.draft?.general_notes ?? data.latest_notes ?? ""); setCtx(data);
    } catch (e) { setError(e.message); }
    setBusy("");
  };
  useEffect(() => { load(); }, [groupId]); // group changes remount the editor
  const assignedSet = new Set(ctx?.assigned_tent_ids || []);
  const relevant = (ctx?.tents || []).filter(t => assignedSet.has(t.id));
  const visibleIds = new Set([...relevant.map(t => t.id), ...Object.keys(entries)]);
  const entryList = Object.entries(entries).map(([tent_id, e]) => ({ tent_id, ...e }));
  const totals = computeTotals(entryList);
  const invalid = entryList.some(e => entryWarnings(e, ctx?.tents.find(t => t.id === e.tent_id), assignedSet.has(e.tent_id)).some(w => w !== "NOT_ASSIGNED_TENT"));
  const saveDraft = async () => {
    setBusy("draft");
    try { await call({ action: "save_draft", group_id: groupId, period_key: ctx.period.key, entries: entryList, general_notes: notes }); toast.success("הטיוטה נשמרה"); }
    catch (e) { toast.error(e.message); }
    setBusy("");
  };
  const finishPdf = async version => { await generateAndAttachPdf(version); toast.success(`גרסה ${version.version_number} הוגשה`); await load(ctx.period.key); };
  const submit = async () => {
    if (invalid || !entryList.some(e => e.reported)) return;
    if (!window.confirm(`להגיש ${totals.total} תלמידים? ההגשה תיצור גרסה ו-PDF חדשים ולא תשנה נתונים תפעוליים.`)) return;
    setBusy("submit");
    try {
      const { version } = await call({ action: "submit", group_id: groupId, period_key: ctx.period.key, entries: entryList, general_notes: notes });
      await finishPdf(version);
    } catch (e) { toast.error(`ההגשה לא הושלמה: ${e.message}`); await load(ctx.period.key); }
    setBusy("");
  };
  const retryPdf = async v => {
    setBusy("submit");
    try { const { version } = await call({ action: "version_detail", version_id: v.id }); await finishPdf(version); }
    catch (e) { toast.error(e.message); }
    setBusy("");
  };
  const loadHistory = async () => {
    setBusy("history");
    try {
      const page = await call({ action: "history", group_id: groupId, period_key: ctx.period.key, cursor: ctx.next_cursor });
      setCtx(old => ({ ...old, versions: [...old.versions, ...page.versions], has_more: page.has_more, next_cursor: page.next_cursor }));
    } catch (e) { toast.error(e.message); }
    setBusy("");
  };
  return { ctx, entries, notes, setNotes, busy, error, selected, setSelected, load, assignedSet, visibleIds, totals, invalid, saveDraft, submit, retryPdf, loadHistory,
    update: e => setEntries(m => ({ ...m, [selected]: { ...e, reported: true } })) };
}