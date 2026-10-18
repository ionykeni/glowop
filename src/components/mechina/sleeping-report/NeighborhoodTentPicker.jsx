import { useState } from "react";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { entryWarnings } from "@/lib/mechinaSleepingReportCalc";

// Visual neighborhood → tent selector. Shows only the tents passed in (assigned + exceptions).
export default function NeighborhoodTentPicker({ neighborhoods, tents, entries, assignedSet, selectedTentId, onSelect }) {
  const [open, setOpen] = useState(() => new Set(neighborhoods.map(n => n.id)));
  const toggle = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-2">
      {neighborhoods.map(nb => {
        const nbTents = tents.filter(t => t.neighborhood_id === nb.id);
        if (!nbTents.length) return null;
        const nbTotal = nbTents.reduce((s, t) => s + Number(entries[t.id]?.boys || 0) + Number(entries[t.id]?.girls || 0), 0);
        const isOpen = open.has(nb.id);
        return (
          <div key={nb.id} className="bg-card border border-border rounded-xl overflow-hidden">
            <button onClick={() => toggle(nb.id)} className="w-full flex items-center justify-between px-4 py-3">
              <span className="font-semibold text-sm text-foreground">{nb.name}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {nbTotal} חניכים
                <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-3 pb-3">
                {nbTents.map(t => {
                  const e = entries[t.id] || {};
                  const total = Number(e.boys || 0) + Number(e.girls || 0);
                  const warn = entryWarnings(e, t, assignedSet.has(t.id)).length > 0;
                  const sel = t.id === selectedTentId;
                  return (
                    <button key={t.id} onClick={() => onSelect(t.id)}
                      className={`relative rounded-lg border px-2 py-2 text-center transition-colors ${sel ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted"} ${!assignedSet.has(t.id) ? "border-dashed" : ""}`}>
                      {warn && <AlertTriangle className="absolute top-1 left-1 w-3.5 h-3.5 text-orange-500" />}
                      <p className="text-sm font-bold text-foreground">{t.code}</p>
                      <p className="text-[11px] text-muted-foreground">{total}/{t.capacity || "?"}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}