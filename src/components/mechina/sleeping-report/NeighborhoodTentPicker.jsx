import ReportTentCard from "@/components/mechina/sleeping-report/ReportTentCard";
import { normalizeEntry } from "@/lib/mechinaSleepingReportCalc";
export default function NeighborhoodTentPicker({ neighborhoods, tents, entries, assignedSet, selectedTentId, onSelect }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {[...neighborhoods].sort((a, b) => a.sort_order - b.sort_order).map(nb => {
      const group = tents.filter(t => t.neighborhood_id === nb.id).sort((a, b) => String(a.code).localeCompare(String(b.code), "he", { numeric: true }));
      if (!group.length) return null;
      const total = group.reduce((n, t) => n + normalizeEntry(entries[t.id]).count, 0);
      return <section key={nb.id} className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="flex justify-between gap-2 border-b border-border bg-muted/50 px-4 py-3">
          <h2 className="font-heading text-base">{nb.name}</h2><span className="text-sm text-muted-foreground">{total} תלמידים</span>
        </header>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-3">
          {group.map(t => <ReportTentCard key={t.id} tent={t} entry={normalizeEntry(entries[t.id])} assigned={assignedSet.has(t.id)} selected={selectedTentId === t.id} onClick={() => onSelect(t.id)} />)}
        </div>
      </section>;
    })}
  </div>;
}