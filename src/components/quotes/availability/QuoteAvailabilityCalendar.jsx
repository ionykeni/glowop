import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import AvailabilityDayCell from "./AvailabilityDayCell";
import AvailabilityDayDetail from "./AvailabilityDayDetail";

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const iso = (y, m, day) => new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);

/** Informational site sleeping availability (before adding the current Quote). */
export default function QuoteAvailabilityCalendar({ open, onClose, initialDate }) {
  const base = initialDate ? new Date(`${initialDate}T00:00:00Z`) : new Date();
  const [month, setMonth] = useState({ y: base.getUTCFullYear(), m: base.getUTCMonth() });
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setSelected(null);
    base44.functions.invoke("getQuoteAvailabilityCalendar", { start_date: iso(month.y, month.m, 1), end_date: iso(month.y, month.m + 1, 1) })
      .then(res => { if (active) setDays(Object.fromEntries((res.data?.days || []).map(x => [x.night, x]))); })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, month.y, month.m]);

  const shift = delta => setMonth(({ y, m }) => { const x = new Date(Date.UTC(y, m + delta, 1)); return { y: x.getUTCFullYear(), m: x.getUTCMonth() }; });
  const today = new Date();
  const firstDow = new Date(Date.UTC(month.y, month.m, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: dayCount }, (_, i) => i + 1)];
  const title = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString("he-IL", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle className="text-right">📅 זמינות לינה באתר</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">תמונת מצב לפני הוספת ההצעה הנוכחית · מידע בלבד, אינו שריון</p>
        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="icon" onClick={() => shift(-1)}><ChevronRight /></Button>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">{title}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMonth({ y: today.getFullYear(), m: today.getMonth() })}>היום</Button>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={() => shift(1)}><ChevronLeft /></Button>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400 mb-1">{WEEKDAYS.map(w => <div key={w}>{w}</div>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((n, i) => {
                const key = n ? iso(month.y, month.m, n) : null;
                return <AvailabilityDayCell key={i} dayNum={n} info={key && days[key]} selected={selected === key} onClick={() => setSelected(key)} />;
              })}
            </div>
          </div>
          <div className="sm:w-56"><AvailabilityDayDetail info={selected && days[selected]} /></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}