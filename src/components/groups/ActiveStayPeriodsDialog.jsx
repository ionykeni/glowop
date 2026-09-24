import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ActiveStayPeriodEditor from "@/components/groups/ActiveStayPeriodEditor";
import ActiveStayChangeSummary from "@/components/groups/ActiveStayChangeSummary";
import SleepingDecisionPanel from "@/components/groups/SleepingDecisionPanel";
import useActiveStayChange from "@/hooks/useActiveStayChange";

export default function ActiveStayPeriodsDialog({ open, groupId, onClose, onApplied }) {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [keepSleeping, setKeepSleeping] = useState(null);
  const flow = useActiveStayChange(groupId, data => {
    if (!data.success) toast.error(data.message || "עדכון הלינה לא הושלם");
    onApplied?.(data); onClose();
  });
  useEffect(() => {
    if (!open) return;
    setLoading(true); setConfirmed(false); setKeepSleeping(null); flow.resetPreview();
    base44.entities.GroupStayPeriod.filter({ group_id: groupId, status: "ACTIVE" }, "start_date", 100).then(rows => {
      const loaded = rows.map(row => ({
        ...row,
        _draft_id: row.id,
        _stored: {
          id: row.id,
          start_date: row.start_date,
          end_date: row.end_date,
          arrival_time: row.arrival_time,
          departure_time: row.departure_time,
          notes: row.notes,
          status: row.status,
        },
        _dirty_fields: [],
      }));
      setPeriods(loaded);
      // Read-only check on open: surfaces sleeping rows that no longer match their stay period.
      flow.previewChange(loaded);
    }).finally(() => setLoading(false));
  }, [open, groupId]);
  const changePeriods = next => { setPeriods(next); setConfirmed(false); setKeepSleeping(null); flow.resetPreview(); };
  const decision = flow.preview?.sleeping_decision;
  const needsDecision = decision?.required && keepSleeping === null;
  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-right"><DialogTitle>עריכת תקופות שהייה פעילות</DialogTitle><DialogDescription>השינוי ייבדק מול לינה, שכונות, קיבולת, ארוחות ותאריכים תפעוליים לפני החלה.</DialogDescription></DialogHeader>
        {loading ? <p className="py-8 text-center text-muted-foreground">טוען תקופות...</p> : <ActiveStayPeriodEditor periods={periods} onChange={changePeriods} disabled={flow.busy} />}
        {flow.error && <p className="text-sm text-red-600">{flow.error}</p>}
        <ActiveStayChangeSummary preview={flow.preview} />
        {flow.preview?.allowed && <SleepingDecisionPanel decision={decision} value={keepSleeping} onChange={setKeepSleeping} />}
        {flow.preview?.allowed && <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} /><span>בדקתי את ההשפעות ואני מאשר/ת להחיל את השינוי המבוקר.</span></label>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={flow.busy}>ביטול</Button><Button variant="outline" onClick={() => { setKeepSleeping(null); flow.previewChange(periods); }} disabled={flow.busy || loading}>{flow.busy ? "בודק..." : "תצוגה מקדימה"}</Button><Button onClick={() => flow.applyChange(periods, decision?.required ? keepSleeping : null)} disabled={flow.busy || !flow.preview?.allowed || !confirmed || needsDecision}>אישור והחלת השינוי</Button></div>
      </DialogContent>
    </Dialog>
  );
}