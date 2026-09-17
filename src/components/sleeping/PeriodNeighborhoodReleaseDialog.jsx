import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SLEEPING_PERIOD_SCOPE } from "@/lib/sleepingPeriodScope";
import { toast } from "sonner";

export default function PeriodNeighborhoodReleaseDialog({ target, groupId, selectedPeriodId, hasLaterPeriods, onClose, onSaved }) {
  const [scope, setScope] = useState(SLEEPING_PERIOD_SCOPE.ONLY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const tentCount = new Set(target.allocations.map(row => row.tent_id)).size;
  const paxCount = target.allocations.reduce((sum, row) => sum + Number(row.allocated_pax || 0), 0);

  const release = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await base44.functions.invoke("manageScopedSleepingRelease", {
        action: "RELEASE_NEIGHBORHOOD", group_id: groupId, neighborhood_id: target.neighborhood.id,
        edit_scope: { mode: hasLaterPeriods ? scope : SLEEPING_PERIOD_SCOPE.ONLY, selected_period_id: selectedPeriodId },
      });
      if (!data?.success) throw new Error(data?.error || "שחרור השכונה נכשל");
      toast.success(data.affected_period_count > 1 ? "השכונה שוחררה בתקופה זו ובתקופות הבאות" : "השכונה שוחררה בתקופה זו");
      onSaved();
    } catch (err) { setError(err?.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  return <Dialog open onOpenChange={onClose}><DialogContent className="max-w-sm" dir="rtl"><DialogHeader><DialogTitle className="text-right">שחרור {target.neighborhood.name}</DialogTitle></DialogHeader><div className="space-y-4">
    <p className="text-sm text-slate-600">פעולה זו תשחרר {tentCount} אוהלים ו־{paxCount} מקומות בתקופה שנבחרה.</p>
    {hasLaterPeriods && <div className="space-y-2"><p className="text-xs font-semibold text-slate-600">כיצד להחיל את השחרור?</p>{[[SLEEPING_PERIOD_SCOPE.ONLY,"רק לתקופה הזו"],[SLEEPING_PERIOD_SCOPE.FORWARD,"לתקופה הזו ולכל התקופות הבאות"]].map(([value,label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="radio" checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}</div>}
    {!hasLaterPeriods && <p className="text-xs text-slate-500">השחרור יחול על התקופה הזו בלבד.</p>}
    {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button><Button variant="destructive" onClick={release} disabled={saving}>{saving ? "משחרר..." : "שחרר שכונה"}</Button></div>
  </div></DialogContent></Dialog>;
}