import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

const shiftDate = (d, n) => {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

export default function PlanTemplateSection({ template, date, onDateChange }) {
  return (
    <section className="activity-day-section space-y-4">
      <h2 className="text-sm font-bold text-slate-500">א. תבנית ותאריך</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-lg font-bold text-slate-800">{template.name}</p>
        <span className="flex items-center gap-1 text-xs text-slate-500"><Lock className="w-3.5 h-3.5" /> גרסה מוכנה {template.version}</span>
        <span className="text-xs text-slate-500">{template.stations.length} תחנות</span>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1">
          <label className="text-xs text-slate-500">תאריך יום הפעילות</label>
          <Input aria-label="תאריך יום הפעילות" type="date" value={date} onChange={e => onDateChange(e.target.value)} className="w-44" />
        </div>
        {date && (
          <div className="flex gap-1">
            <button onClick={() => onDateChange(shiftDate(date, -1))} className="text-xs border border-slate-200 rounded-md px-2 py-2 hover:bg-slate-50">יום קודם</button>
            <button onClick={() => onDateChange(shiftDate(date, 1))} className="text-xs border border-slate-200 rounded-md px-2 py-2 hover:bg-slate-50">יום הבא</button>
          </div>
        )}
      </div>
    </section>
  );
}