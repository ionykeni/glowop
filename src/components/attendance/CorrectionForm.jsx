import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCorrection } from "@/hooks/useAttendance";
import { fmtTime, israelToday } from "@/lib/attendanceFormat";

// Simple correction: date, start, end, optional note. No reason is required.
export default function CorrectionForm({ record, workerId, onDone }) {
  const active = record?.status === "ACTIVE";
  const [form, setForm] = useState(() => ({
    date: record?.local_date || israelToday(),
    start_time: record ? fmtTime(record.start_at) : "",
    end_time: record?.end_at && !active ? fmtTime(record.end_at) : "",
    note: "",
  }));
  const [error, setError] = useState("");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const m = useCorrection();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const send = (payload) => { setError(""); m.mutate(payload, { onSuccess: onDone, onError: (e) => setError(e.message) }); };
  const save = () => send({ action: "save", record_id: record?.id, worker_profile_id: workerId, ...form, end_time: active ? "" : form.end_time });

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
      <div className={`grid gap-2 ${active ? "grid-cols-2" : "grid-cols-3"}`}>
        <label className="text-xs space-y-1"><span className="text-muted-foreground">תאריך</span><Input type="date" value={form.date} onChange={set("date")} /></label>
        <label className="text-xs space-y-1"><span className="text-muted-foreground">שעת התחלה</span><Input type="time" value={form.start_time} onChange={set("start_time")} /></label>
        {!active && <label className="text-xs space-y-1"><span className="text-muted-foreground">שעת סיום</span><Input type="time" value={form.end_time} onChange={set("end_time")} /></label>}
      </div>
      <Input placeholder="הערה (לא חובה)" value={form.note} onChange={set("note")} maxLength={300} />
      <p className="text-[11px] text-muted-foreground">{active ? "העבודה עדיין פעילה — אפשר לתקן את שעת ההתחלה בלבד." : "שעת סיום מוקדמת משעת ההתחלה נחשבת לסיום למחרת."}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={m.isPending}>{m.isPending && <Loader2 className="w-4 h-4 animate-spin" />}שמירה</Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={m.isPending}>ביטול</Button>
        {record && (confirmVoid ? (
          <Button size="sm" variant="destructive" className="ms-auto" disabled={m.isPending} onClick={() => send({ action: "void", record_id: record.id, note: form.note })}>לאשר ביטול הרשומה?</Button>
        ) : (
          <Button size="sm" variant="ghost" className="ms-auto text-destructive" onClick={() => setConfirmVoid(true)}>הרשומה נוצרה בטעות</Button>
        ))}
      </div>
    </div>
  );
}