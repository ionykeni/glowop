import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DAY_NAMES, weekDates, dayOfWeek } from "@/lib/spaceCalendarView";

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const fmt = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

export default function VscToolbar({ mode, date, onMode, onShift, onToday, onDate }) {
  const title = mode === "day"
    ? `יום ${DAY_NAMES[dayOfWeek(date)]}, ${fmt(date)} ${date.slice(0, 4)}`
    : (() => { const w = weekDates(date); return `${fmt(w[0])} – ${fmt(w[6])} ${w[6].slice(0, 4)}`; })();
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => onShift(-1)} aria-label={mode === "day" ? "יום קודם" : "שבוע קודם"}><ChevronRight className="w-4 h-4" /></Button>
        <Button size="sm" variant="outline" onClick={onToday} className="px-3">היום</Button>
        <Button size="sm" variant="outline" onClick={() => onShift(1)} aria-label={mode === "day" ? "יום הבא" : "שבוע הבא"}><ChevronLeft className="w-4 h-4" /></Button>
        <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} aria-label="בחירת תאריך"
          className="h-8 border border-input rounded-md px-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring/30" />
        <span className="font-heading text-sm sm:text-base mr-1">{title}</span>
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        {[["day", "יומי"], ["week", "שבועי"]].map(([id, label]) => (
          <Button key={id} size="sm" variant={mode === id ? "default" : "ghost"} className="h-7 px-3" onClick={() => onMode(id)}>{label}</Button>
        ))}
      </div>
    </div>
  );
}