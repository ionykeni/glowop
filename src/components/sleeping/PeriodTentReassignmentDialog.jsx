import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SLEEPING_PERIOD_SCOPE } from "@/lib/sleepingPeriodScope";
import { toast } from "sonner";
import { sortTentsNaturally } from "./tentCodeSort";

export default function PeriodTentReassignmentDialog({ target, groupId, tents, hasLaterPeriods, onClose, onSaved }) {
  const isVip = /__vip_req_\d+__/i.test(target.notes || "");
  const compatible = sortTentsNaturally(tents.filter(tent => tent.working_status === "WORKING" && tent.id !== target.tent_id && (isVip ? tent.tent_type === "VIP" : tent.tent_type !== "VIP")));
  const [destinationId, setDestinationId] = useState("");
  const [scope, setScope] = useState(SLEEPING_PERIOD_SCOPE.ONLY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await base44.functions.invoke("updateScopedSleepingLocation", { group_id: groupId, allocation_id: target.id, allocation_series_id: target.allocation_series_id, destination_tent_id: destinationId, edit_scope: { mode: hasLaterPeriods ? scope : SLEEPING_PERIOD_SCOPE.ONLY, selected_period_id: target.stay_period_id } });
      if (!data?.success) throw new Error(data?.error || "שינוי האוהל נכשל");
      toast.success(data.affected_period_count > 1 ? "האוהל עודכן בתקופה זו ובתקופות הבאות" : "האוהל עודכן בתקופה זו");
      onSaved();
    } catch (err) { setError(err?.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={onClose}><DialogContent className="max-w-sm" dir="rtl"><DialogHeader><DialogTitle className="text-right">שינוי אוהל</DialogTitle></DialogHeader><div className="space-y-4">
    <div><label className="text-xs font-semibold text-slate-600">אוהל יעד</label><select value={destinationId} onChange={event => setDestinationId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="">בחר אוהל</option>{compatible.map(tent => <option key={tent.id} value={tent.id}>{tent.code}</option>)}</select></div>
    {hasLaterPeriods && <div className="space-y-2"><p className="text-xs font-semibold text-slate-600">כיצד להחיל את השינוי?</p>{[[SLEEPING_PERIOD_SCOPE.ONLY,"רק לתקופה הזו"],[SLEEPING_PERIOD_SCOPE.FORWARD,"לתקופה הזו ולכל התקופות הבאות"]].map(([value,label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="radio" checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}</div>}
    {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button><Button onClick={save} disabled={saving || !destinationId}>{saving ? "שומר..." : "שמור שינוי"}</Button></div>
  </div></DialogContent></Dialog>;
}