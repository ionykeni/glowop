import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { entryWarnings, WARNING_LABELS } from "@/lib/mechinaSleepingReportCalc";
export default function TentEntryEditor({ tent, neighborhood, entry, assigned, onChange, onClose }) {
  const warnings = entryWarnings(entry, tent, assigned);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent dir="rtl" className="max-w-md max-h-[90dvh] overflow-y-auto">
      <DialogHeader className="text-right">
        <DialogTitle>אוהל {tent.code}</DialogTitle>
        <DialogDescription>{neighborhood} · קיבולת פיזית: {tent.capacity} · משובצים רשמית: {tent.official_pax || 0}</DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-2"><legend className="text-sm font-semibold">כמה תלמידים ישנים כאן בפועל?</legend>
        <div className="grid grid-cols-5 gap-2">{Array.from({ length: tent.capacity + 1 }, (_, count) => <Button key={count} type="button" variant={entry.count === count ? "default" : "outline"} aria-pressed={entry.count === count} onClick={() => onChange({ ...entry, count, gender: count === 0 ? "" : entry.gender })}>{count}</Button>)}</div>
      </fieldset>
      <fieldset className="space-y-2"><legend className="text-sm font-semibold">מגדר אחד לאוהל</legend>
        <div className="flex gap-2">{[["BOYS", "בנים"], ["GIRLS", "בנות"]].map(([gender, label]) => <Button key={gender} className="flex-1" variant={entry.gender === gender ? "default" : "outline"} disabled={entry.count === 0} aria-pressed={entry.gender === gender} onClick={() => onChange({ ...entry, gender })}>{label}</Button>)}</div>
      </fieldset>
      {warnings.map(w => <p role={w === "NOT_ASSIGNED_TENT" ? undefined : "alert"} key={w} className="text-sm text-destructive">{WARNING_LABELS[w]}</p>)}
      <label className="space-y-1 text-sm">הערה / חריגה
        <textarea value={entry.note} maxLength={500} onChange={e => onChange({ ...entry, note: e.target.value })} rows={3} placeholder="למשל: שני תלמידים ישנים זמנית במקום אחר" className="block w-full rounded-lg border border-border bg-background p-2 mt-1" />
      </label>
      <Button onClick={() => { onChange(entry); onClose(); }}>סיום ועדכון המפה</Button>
    </DialogContent>
  </Dialog>;
}