import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import ProposalRow from "./ProposalRow";
import { applyContinuous, applyMultiPeriod } from "./applyProposal";

const parse = (v) => { try { return JSON.parse(v || "[]"); } catch { return []; } };

// Assistant-prepared, fully prefilled proposal inside the existing לינה tab.
export default function AssistantProposalPanel({ proposalId, groupId, isMultiPeriod, profileId, arrivalDate, departureDate, allTents, neighborhoods, activeNhoodRes, logicalAssignments, onConfirmContinuous, onSaved }) {
  const { data: proposal, isLoading } = useQuery({
    queryKey: ["sleepingProposal", proposalId],
    queryFn: () => base44.entities.SleepingAllocationProposal.get(proposalId),
  });
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (proposal) setRows(parse(proposal.items_json)); }, [proposal]);

  const tentOptions = useMemo(() => {
    const hoods = Object.fromEntries(neighborhoods.filter(n => !n.is_vip).map(n => [n.id, n.name]));
    return allTents.filter(t => hoods[t.neighborhood_id] && t.tent_type !== "VIP")
      .map(t => ({ ...t, neighborhood_name: hoods[t.neighborhood_id] }))
      .sort((a, b) => `${a.neighborhood_name}${a.code}`.localeCompare(`${b.neighborhood_name}${b.code}`, "he", { numeric: true }));
  }, [allTents, neighborhoods]);

  if (isLoading) return <div className="text-xs text-muted-foreground"><Loader2 className="inline w-3 h-3 animate-spin" /> טוען הצעת שיבוץ…</div>;
  if (!proposal || proposal.group_id !== groupId || proposal.status !== "PENDING") return null;

  const taken = new Set(rows.map(r => r.tent_id));
  const update = (i, patch) => setRows(rs => rs.map((r, idx) => {
    if (idx !== i) return r;
    const next = { ...r, ...patch };
    if (patch.tent_id) next.neighborhood_id = tentOptions.find(t => t.id === patch.tent_id)?.neighborhood_id;
    return next;
  }));
  const addRow = () => {
    const free = tentOptions.find(t => !taken.has(t.id));
    if (free) setRows(rs => [...rs, { tent_id: free.id, neighborhood_id: free.neighborhood_id, gender_group: "BOYS", allocated_pax: 8 }]);
  };
  const total = g => rows.filter(r => r.gender_group === g).reduce((s, r) => s + (Number(r.allocated_pax) || 0), 0);

  const approve = async () => {
    const clean = rows.map(r => ({ ...r, allocated_pax: Number(r.allocated_pax) || 0 })).filter(r => r.allocated_pax > 0);
    if (!clean.length) return;
    setSaving(true); setError(null);
    try {
      const ok = isMultiPeriod
        ? await applyMultiPeriod({ rows: clean, groupId, logicalAssignments })
        : await applyContinuous({ rows: clean, groupId, profileId, arrivalDate, departureDate, activeNhoodRes, confirm: onConfirmContinuous });
      if (ok) {
        const me = await base44.auth.me();
        await base44.entities.SleepingAllocationProposal.update(proposalId, { status: "APPLIED", applied_at: new Date().toISOString(), applied_by: me.email, items_json: JSON.stringify(clean) });
        toast.success("השיבוץ אושר ונשמר ✓");
      }
      onSaved();
    } catch (err) {
      setError(err?.message || "שמירת השיבוץ נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    await base44.entities.SleepingAllocationProposal.update(proposalId, { status: "DISCARDED" });
    onSaved();
  };

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-2" dir="rtl">
      <div className="flex items-center gap-2 font-semibold text-sm"><Sparkles className="w-4 h-4 text-primary" /> השיבוץ מוכן לבדיקה — הוכן ע״י העוזר הלוגיסטי</div>
      <p className="text-xs text-muted-foreground">בנים: {total("BOYS")} · בנות: {total("GIRLS")} · {rows.length} אוהלים. ניתן לערוך כל שורה לפני האישור. שום שיבוץ לא נשמר עד לחיצה על ״אשר שיבוץ״.</p>
      {parse(proposal.warnings_json).map(w => <div key={w} className="flex gap-1 text-xs text-amber-700"><AlertTriangle className="w-3 h-3 mt-0.5" />{w}</div>)}
      <div className="space-y-1.5">
        {rows.map((r, i) => <ProposalRow key={i} row={r} tentOptions={tentOptions} takenTentIds={taken} onChange={p => update(i, p)} onRemove={() => setRows(rs => rs.filter((_, idx) => idx !== i))} />)}
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={approve} disabled={saving || !rows.length}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}אשר שיבוץ</Button>
        <Button size="sm" variant="outline" onClick={addRow} disabled={saving}><Plus className="w-4 h-4" />הוסף אוהל</Button>
        <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>בטל הצעה</Button>
      </div>
    </div>
  );
}