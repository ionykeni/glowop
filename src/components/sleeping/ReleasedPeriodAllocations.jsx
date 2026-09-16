import { Button } from "@/components/ui/button";
import RoleGate from "@/components/RoleGate";

export default function ReleasedPeriodAllocations({ allocations, tents, onReAdd }) {
  if (!allocations.length) return null;
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" dir="rtl">
    <p className="mb-2 text-xs font-semibold text-slate-600">שיבוצים ששוחררו בתקופה זו</p>
    <div className="flex flex-wrap gap-2">{allocations.map(row => <div key={row.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><span>אוהל {tents.find(tent => tent.id === row.tent_id)?.code || "?"} · {row.allocated_pax} אנשים</span><RoleGate permission="MANAGE_ALLOCATION"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onReAdd(row)}>שבץ מחדש</Button></RoleGate></div>)}</div>
  </div>;
}