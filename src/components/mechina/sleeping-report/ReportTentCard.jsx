import { Tent, AlertTriangle } from "lucide-react";
import { entryWarnings, genderLabel } from "@/lib/mechinaSleepingReportCalc";
export default function ReportTentCard({ tent, entry, assigned, selected, onClick }) {
  const warning = entryWarnings(entry, tent, assigned).length > 0;
  return <button type="button" onClick={onClick} aria-pressed={selected} aria-label={`אוהל ${tent.code}, ${entry.count} מתוך ${tent.capacity}, ${genderLabel(entry.gender)}`}
    className={`relative overflow-hidden rounded-xl border-2 p-3 text-center min-h-28 ${selected ? "border-primary ring-2 ring-primary/20" : entry.reported ? "border-primary/40" : "border-border"} ${assigned ? "" : "border-dashed"} bg-background hover:bg-muted`}>
    <span className="absolute inset-x-0 bottom-0 bg-primary/10 pointer-events-none" style={{ height: `${tent.capacity ? Math.min(100, entry.count / tent.capacity * 100) : 0}%` }} />
    <span className="relative flex flex-col items-center gap-1">
      <Tent className="w-5 h-5 text-primary" /><span className="font-bold">{tent.code}</span>
      <span className="text-sm">{entry.count} / {tent.capacity}</span>
      <span className="text-xs text-muted-foreground">{entry.count > 0 ? genderLabel(entry.gender) : entry.reported ? "דווח ריק" : "טרם דווח"}</span>
    </span>
    {warning && <AlertTriangle className="absolute left-1 top-1 w-3.5 h-3.5 text-destructive" />}
  </button>;
}