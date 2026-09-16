import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SLEEPING_PERIOD_SCOPE } from "@/lib/sleepingPeriodScope";
import { toast } from "sonner";

export default function PeriodReAddDialog({ target, groupId, tents, onClose, onSaved }) {
  const isVip = /__vip_req_\d+__/i.test(target.notes || "");
  const compatible = tents.filter(tent => tent.working_status === "WORKING" && (isVip ? tent.tent_type === "VIP" : tent.tent_type !== "VIP"));
  const [destinationId, setDestinationId] = useState(target.tent_id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await base44.functions.invoke("manageScopedSleepingRelease", { action: "READD", group_id: groupId, allocation_id: target.id, destination_tent_id: destinationId, edit_scope: { mode: SLEEPING_PERIOD_SCOPE.ONLY, selected_period_id: target.stay_period_id } });
      if (!data?.success) throw new Error(data?.error || "השיבוץ מחדש נכשל");
      toast.success("האוהל שובץ מחדש בתקופה זו"); onSaved();
    } catch (err) { setError(err?.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={onClose}><DialogContent className="max-w-sm" dir="rtl"><DialogHeader><DialogTitle className="text-right">שיבוץ מחדש לתקופה</DialogTitle></DialogHeader><div className="space-y-4">
    <div><label className="text-xs font-semibold text-slate-600">אוהל</label><select value={destinationId} onChange={event => setDestinationId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="">בחר אוהל</option>{compatible.map(tent => <option key={tent.id} value={tent.id}>{tent.code}</option>)}</select></div>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button><Button onClick={save} disabled={saving || !destinationId}>{saving ? "שומר..." : "שבץ מחדש"}</Button></div>
  </div></DialogContent></Dialog>;
}