import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SLEEPING_PERIOD_SCOPE } from "@/lib/sleepingPeriodScope";
import { toast } from "sonner";

export default function PeriodPaxEditDialog({ target, groupId, hasLaterPeriods, onClose, onSaved }) {
  const [pax, setPax] = useState(target.allocated_pax);
  const [scope, setScope] = useState(SLEEPING_PERIOD_SCOPE.ONLY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await base44.functions.invoke("updateScopedSleepingPax", { group_id: groupId, allocation_id: target.id, allocation_series_id: target.allocation_series_id, allocated_pax: Number(pax), edit_scope: { mode: hasLaterPeriods ? scope : SLEEPING_PERIOD_SCOPE.ONLY, selected_period_id: target.stay_period_id } });
      if (!data?.success) throw new Error(data?.error || "שמירת הכמות נכשלה");
      toast.success(data.affected_period_count > 1 ? "הכמות עודכנה בתקופה זו ובתקופות הבאות" : "הכמות עודכנה בתקופה זו");
      onSaved();
    } catch (err) { setError(err?.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={onClose}><DialogContent className="max-w-sm" dir="rtl"><DialogHeader><DialogTitle className="text-right">עריכת מספר אנשים</DialogTitle></DialogHeader><div className="space-y-4">
    <div><label className="text-xs font-semibold text-slate-600">מספר אנשים חדש</label><Input type="number" min="1" value={pax} onChange={event => setPax(event.target.value)} className="mt-1" /></div>
    {hasLaterPeriods && <div className="space-y-2"><p className="text-xs font-semibold text-slate-600">על אילו תקופות להחיל?</p>{[[SLEEPING_PERIOD_SCOPE.ONLY,"רק לתקופה הזו"],[SLEEPING_PERIOD_SCOPE.FORWARD,"לתקופה הזו ולכל התקופות הבאות"]].map(([value,label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="radio" checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}</div>}
    {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button><Button onClick={save} disabled={saving || Number(pax) < 1}>{saving ? "שומר..." : "שמור שינוי"}</Button></div>
  </div></DialogContent></Dialog>;
}