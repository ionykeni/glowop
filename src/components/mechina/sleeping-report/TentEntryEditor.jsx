import { AlertTriangle, Minus, Plus, X } from "lucide-react";
import { entryWarnings, WARNING_LABELS } from "@/lib/mechinaSleepingReportCalc";

function Stepper({ label, value, onChange, cls }) {
  const v = Number(value || 0);
  return (
    <div className="flex-1 space-y-1">
      <p className={`text-xs font-semibold ${cls}`}>{label}</p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(Math.max(0, v - 1))} className="w-10 h-10 rounded-lg border border-border flex items-center justify-center"><Minus className="w-4 h-4" /></button>
        <input type="number" inputMode="numeric" min={0} value={v}
          onChange={e => onChange(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
          className="w-14 h-10 text-center text-lg font-bold border border-border rounded-lg bg-background" />
        <button type="button" onClick={() => onChange(v + 1)} className="w-10 h-10 rounded-lg border border-border flex items-center justify-center"><Plus className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export default function TentEntryEditor({ tent, entry, assigned, onChange, onRemove, onClose }) {
  const warnings = entryWarnings(entry, tent, assigned);
  return (
    <div className="bg-card border-2 border-primary/40 rounded-xl p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-bold text-foreground">אוהל {tent.code}</p>
          <p className="text-xs text-muted-foreground">קיבולת פיזית: {tent.capacity || "לא ידוע"} · משובצים רשמית: {tent.official_pax || 0}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground"><X className="w-5 h-5" /></button>
      </div>
      <div className="flex gap-3">
        <Stepper label="בנים" value={entry.boys} cls="text-primary" onChange={boys => onChange({ ...entry, boys })} />
        <Stepper label="בנות" value={entry.girls} cls="text-pink-600" onChange={girls => onChange({ ...entry, girls })} />
      </div>
      {warnings.map(w => (
        <div key={w} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${w === "OVER_CAPACITY" ? "bg-destructive/10 text-destructive" : "bg-orange-50 text-orange-700"}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" /> {WARNING_LABELS[w]} — הדיווח יישמר כפי שהוזן
        </div>
      ))}
      <textarea value={entry.note || ""} onChange={e => onChange({ ...entry, note: e.target.value })} rows={2}
        placeholder={assigned ? "הערה (אופציונלי)" : "הסבר החריגה — למשל: חניכים מאוהל 21 ישנים כאן"}
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
      {!assigned && (
        <button onClick={onRemove} className="text-xs text-destructive underline">הסר אוהל חריגה מהדיווח</button>
      )}
    </div>
  );
}