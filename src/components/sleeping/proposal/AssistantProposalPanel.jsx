import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import ProposalRow from "./ProposalRow";
import ProposalReconciliation from "./ProposalReconciliation";
import { applyContinuous, applyMultiPeriod, parseState, rollbackAttempt } from "./applyProposal";

const parse = (v) => { try { return JSON.parse(v || "[]"); } catch { return []; } };
const SPECIAL = /__(?:vip_req_\d+|alt_tent)__/i;

// Assistant-prepared, fully prefilled proposal inside the existing לינה tab.
export default function AssistantProposalPanel({ proposalId, groupId, isMultiPeriod, profile, arrivalDate, departureDate, allTents, neighborhoods, activeNhoodRes, groupAllocs, otherActiveAllocs, logicalAssignments, onConfirmContinuous, onSaved }) {
  const { data: proposal, isLoading, refetch } = useQuery({
    queryKey: ["sleepingProposal", proposalId],
    queryFn: () => base44.entities.SleepingAllocationProposal.get(proposalId),
  });
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [needsShared, setNeedsShared] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { if (proposal) setRows(parse(proposal.items_json)); }, [proposal?.id]);

  const state = parseState(proposal);
  const createdIds = new Set(state.created_alloc_ids);

  const markApplied = async (items) => {
    const me = await base44.auth.me();
    await base44.entities.SleepingAllocationProposal.update(proposalId, { status: "APPLIED", applied_at: new Date().toISOString(), applied_by: me.email, items_json: JSON.stringify(items) });
  };

  // Confirmation completed elsewhere (e.g. the tab's shared-neighborhood box) → close the proposal.
  useEffect(() => {
    if (!proposal || proposal.status !== "PENDING" || isMultiPeriod || !state.created_alloc_ids.length) return;
    const mine = groupAllocs.filter(a => createdIds.has(a.id));
    if (mine.length === state.created_alloc_ids.length && mine.every(a => a.status === "CONFIRMED")) markApplied(rows).then(onSaved);
  }, [proposal, groupAllocs]);

  const tentOptions = useMemo(() => {
    const hoods = Object.fromEntries(neighborhoods.filter(n => !n.is_vip).map(n => [n.id, n.name]));
    return allTents.filter(t => hoods[t.neighborhood_id] && t.tent_type !== "VIP")
      .map(t => ({ ...t, neighborhood_name: hoods[t.neighborhood_id] }))
      .sort((a, b) => `${a.neighborhood_name}${a.code}`.localeCompare(`${b.neighborhood_name}${b.code}`, "he", { numeric: true }));
  }, [allTents, neighborhoods]);

  if (isLoading) return <div className="text-xs text-muted-foreground"><Loader2 className="inline w-3 h-3 animate-spin" /> טוען הצעת שיבוץ…</div>;
  if (!proposal || proposal.group_id !== groupId || proposal.status !== "PENDING") return null;

  const existing = isMultiPeriod
    ? logicalAssignments.filter(a => !a.inconsistent && a.allocation_type === "STUDENT").map(a => ({ gender_group: a.gender_group, pax: a.logical_allocated_pax }))
    : groupAllocs.filter(a => a.allocation_type === "STUDENT" && a.status !== "CANCELLED" && !createdIds.has(a.id) && !SPECIAL.test(a.notes || "")).map(a => ({ gender_group: a.gender_group, pax: a.allocated_pax }));

  const taken = new Set(rows.map(r => r.tent_id));
  const tentCode = id => allTents.find(t => t.id === id)?.code || id;
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

  const run = async (fn) => {
    setSaving(true); setError(null);
    try { await fn(); } catch (err) { setError(err?.message || "שמירת השיבוץ נכשלה"); }
    finally { setSaving(false); await refetch(); onSaved(); }
  };

  const approve = (shared) => run(async () => {
    const clean = rows.map(r => ({ ...r, allocated_pax: Number(r.allocated_pax) || 0 })).filter(r => r.allocated_pax > 0);
    if (!clean.length) return;
    const fresh = await base44.entities.SleepingAllocationProposal.get(proposalId);
    if (fresh.status !== "PENDING") return;
    const result = isMultiPeriod
      ? await applyMultiPeriod({ rows: clean, groupId, logicalAssignments })
      : await applyContinuous({ proposal: fresh, rows: clean, groupId, profileId: profile.id, arrivalDate, departureDate, activeNhoodRes, groupAllocs, otherActiveAllocs, tentCode, confirm: onConfirmContinuous, shared });
    if (result === "NEEDS_SHARED") { setNeedsShared(true); return; }
    await markApplied(clean);
    setNeedsShared(false);
    toast.success("השיבוץ אושר ונשמר ✓");
  });

  const cancelAttempt = () => run(async () => { await rollbackAttempt(proposalId, state, groupId); setNeedsShared(false); });
  const discard = () => run(async () => {
    if (state.created_alloc_ids.length || state.created_nhood_ids.length) await rollbackAttempt(proposalId, state, groupId);
    await base44.entities.SleepingAllocationProposal.update(proposalId, { status: "DISCARDED" });
  });

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-2" dir="rtl">
      <div className="flex items-center gap-2 font-semibold text-sm"><Sparkles className="w-4 h-4 text-primary" /> השיבוץ מוכן לבדיקה — הוכן ע״י העוזר הלוגיסטי</div>
      <p className="text-xs text-muted-foreground">{rows.length} אוהלים. ניתן לערוך כל שורה לפני האישור. שום שיבוץ לא נשמר עד לחיצה על ״אשר שיבוץ״.</p>
      <ProposalReconciliation proposal={proposal} rows={rows} existing={existing} profile={profile} />
      {parse(proposal.warnings_json).map(w => <div key={w} className="flex gap-1 text-xs text-amber-700"><AlertTriangle className="w-3 h-3 mt-0.5" />{w}</div>)}
      {state.recovery_required && <div className="rounded border border-destructive bg-destructive/10 px-2 py-1 text-xs text-destructive">ניסיון אישור קודם לא הושלם ונדרש טיפול ידני: {(state.recovery_ids || []).join(", ")}</div>}
      <div className="space-y-1.5">
        {rows.map((r, i) => <ProposalRow key={i} row={r} tentOptions={tentOptions} takenTentIds={taken} onChange={p => update(i, p)} onRemove={() => setRows(rs => rs.filter((_, idx) => idx !== i))} />)}
      </div>
      {needsShared && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-2 space-y-1.5">
          <p className="text-xs font-semibold text-amber-800">השכונה משותפת עם קבוצה אחרת — הטיוטות נשמרו וממתינות. הזן סיבה לאישור שכונה משותפת:</p>
          <textarea className="w-full text-xs rounded border border-amber-300 px-2 py-1 min-h-[44px]" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex flex-wrap gap-2">
        {needsShared
          ? <Button size="sm" onClick={() => approve({ sharedAllowed: true, sharedReason: reason })} disabled={saving || !reason.trim()}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}אשר עם שכונה משותפת</Button>
          : <Button size="sm" onClick={() => approve()} disabled={saving || !rows.length || state.recovery_required}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}אשר שיבוץ</Button>}
        {needsShared && <Button size="sm" variant="outline" onClick={cancelAttempt} disabled={saving}>בטל את הטיוטות שנוצרו</Button>}
        {!needsShared && <Button size="sm" variant="outline" onClick={addRow} disabled={saving}><Plus className="w-4 h-4" />הוסף אוהל</Button>}
        <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>בטל הצעה</Button>
      </div>
    </div>
  );
}