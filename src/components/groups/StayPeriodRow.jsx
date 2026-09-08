import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function StayPeriodRow({ period, index, onChange, onRemove }) {
  const set = (field, value) => onChange(period._draft_id, {
    ...period,
    [field]: value,
    _dirty_fields: [...new Set([...(period._dirty_fields || []), field])],
  });
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">תקופה {index + 1}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(period._draft_id)}>הסרת תקופה</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>מתאריך</Label><Input type="date" value={period.start_date} onChange={e => set("start_date", e.target.value)} /></div>
        <div className="space-y-1"><Label>עד תאריך</Label><Input type="date" value={period.end_date} onChange={e => set("end_date", e.target.value)} /></div>
        <div className="space-y-1"><Label>שעת הגעה</Label><Input type="time" value={period.arrival_time || ""} onChange={e => set("arrival_time", e.target.value)} /></div>
        <div className="space-y-1"><Label>שעת עזיבה</Label><Input type="time" value={period.departure_time || ""} onChange={e => set("departure_time", e.target.value)} /></div>
      </div>
    </div>
  );
}