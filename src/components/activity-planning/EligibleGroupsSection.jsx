import { Button } from "@/components/ui/button";
import { Loader2, CheckCheck, Copy } from "lucide-react";
import EligibleGroupRow from "./EligibleGroupRow";

export default function EligibleGroupsSection({ plan }) {
  const { date, dayQuery, groups, pool, togglePool, selectAllEligible, applyPoolToAll, pruned } = plan;
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-bold text-slate-500">ב. קבוצות השוהות בתאריך</h2>
      {!date ? (
        <p className="text-sm text-slate-500">יש לבחור תאריך כדי לטעון את הקבוצות השוהות באתר.</p>
      ) : dayQuery.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : dayQuery.data?.success === false ? (
        <p className="text-sm text-red-600">{dayQuery.data.error}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-500">לא נמצאו קבוצות השוהות באתר בתאריך זה.</p>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" size="sm" onClick={selectAllEligible} className="gap-1.5"><CheckCheck className="w-4 h-4" /> בחר את כל הקבוצות השוהות בתאריך</Button>
            <Button size="sm" onClick={applyPoolToAll} disabled={pool.length === 0} className="gap-1.5"><Copy className="w-4 h-4" /> החל על כל התחנות ({pool.length})</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {groups.map(g => <EligibleGroupRow key={g.id} group={g} checked={pool.includes(g.id)} onToggle={() => togglePool(g.id)} />)}
          </div>
        </>
      )}
      {pruned.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {pruned.length} קבוצות הוסרו מהבחירה ומהתחנות כי אינן שוהות באתר בתאריך החדש.
        </p>
      )}
    </section>
  );
}