import { useState } from "react";
import { base44 } from "@/api/base44Client";
import RoleGate from "@/components/RoleGate";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import SleepingActionButton from "./SleepingActionButton";
import { naturalTentCodeCompare } from "./tentCodeSort";
import { toast } from "sonner";

export default function ReleasedPeriodAllocations({ allocations, tents, groupId, onReAdd, onDismissed }) {
  const [dismissTarget, setDismissTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!allocations.length) return null;
  const sorted = [...allocations].sort((left, right) => naturalTentCodeCompare(tents.find(tent => tent.id === left.tent_id), tents.find(tent => tent.id === right.tent_id)));
  const dismiss = async () => {
    setSaving(true);
    try {
      const { data } = await base44.functions.invoke("manageScopedSleepingRelease", { action: "DISMISS_RELEASED_HELPER", group_id: groupId, allocation_id: dismissTarget.id });
      if (!data?.success) throw new Error(data?.error || "הסרת השיבוץ מהרשימה נכשלה");
      setDismissTarget(null); onDismissed(); toast.success("השיבוץ הוסר מרשימת השיבוצים ששוחררו");
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || "הסרת השיבוץ מהרשימה נכשלה");
    } finally {
      setSaving(false);
    }
  };
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" dir="rtl">
    <p className="mb-2 text-xs font-semibold text-slate-600">שיבוצים ששוחררו בתקופה זו</p>
    <div className="flex flex-wrap gap-2">{sorted.map(row => <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm"><span>אוהל {tents.find(tent => tent.id === row.tent_id)?.code || "?"} · {row.allocated_pax} אנשים</span><RoleGate permission="MANAGE_ALLOCATION"><div className="flex gap-1"><SleepingActionButton tone="constructive" onClick={() => onReAdd(row)}>שבץ מחדש</SleepingActionButton><SleepingActionButton tone="destructive" onClick={() => setDismissTarget(row)}>מחק מהרשימה</SleepingActionButton></div></RoleGate></div>)}</div>
    <AlertDialog open={!!dismissTarget} onOpenChange={open => !open && setDismissTarget(null)}><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>להסיר את השיבוץ מרשימת השיבוצים ששוחררו?</AlertDialogTitle><AlertDialogDescription>היסטוריית השיבוץ לא תימחק.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter className="flex-row-reverse gap-2"><AlertDialogAction onClick={dismiss} disabled={saving} className="bg-slate-700 text-white hover:bg-slate-800">{saving ? "מסיר..." : "מחק מהרשימה"}</AlertDialogAction><AlertDialogCancel disabled={saving}>ביטול</AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}