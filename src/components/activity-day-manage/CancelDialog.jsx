import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { callManage, newOpId } from "@/lib/activityDayManageApi";

// Cancels one station (stationId set) or the whole day. Shows exactly what will be released before confirming.
export default function CancelDialog({ execution, stationId, run, onClose, onMessage }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const opId = useMemo(newOpId, []);

  useEffect(() => {
    callManage("preview_cancel", { execution_id: execution.id, station_id: stationId || undefined })
      .then(r => (r.success ? setPreview(r) : setError(r.error)));
  }, [execution.id, stationId]);

  const confirm = async () => {
    setBusy(true);
    const r = await run(stationId ? "cancel_station" : "cancel_day", { station_id: stationId || undefined, op_id: opId, expected_revision: preview.revision, confirmed: true });
    setBusy(false);
    onMessage(r.ok ? { type: "ok", text: stationId ? "התחנה בוטלה והחדר שוחרר" : "יום הפעילות בוטל וכל החדרים שוחררו" } : { type: "error", text: r.message });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="activity-day-ui activity-day-dialog max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>{stationId ? "ביטול תחנה" : "ביטול יום הפעילות כולו"}</DialogTitle></DialogHeader>
        {error ? <div className="text-sm text-red-700 bg-red-50 rounded p-2">{error}</div>
          : !preview ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          : (
            <div className="space-y-3 text-sm">
              <p className="activity-day-cancel-summary text-foreground">הפעילויות הבאות יבוטלו עבור כל הקבוצות, והחדרים ישוחררו ביומן. הרשומות נשמרות להיסטוריה.</p>
              <div className="border border-slate-200 rounded divide-y divide-slate-100">
                {preview.stations.map(s => (
                  <div key={s.station_id} className="p-2">
                    <div className="font-medium text-slate-800">{s.title} · {s.start_time}–{s.end_time} · {s.space_name}</div>
                    <div className="text-xs text-slate-500">{s.groups.join(", ") || "—"}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-500">סה״כ {preview.total_items} רשומות פעילות יבוטלו.</div>
            </div>
          )}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>חזרה</Button>
          <Button variant="destructive" disabled={!preview || busy} onClick={confirm}>{busy && <Loader2 className="animate-spin" />} אישור ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}