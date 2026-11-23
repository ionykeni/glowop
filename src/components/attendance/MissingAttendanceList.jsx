import { CalendarX } from "lucide-react";

// Published planned shifts (already started) with no attendance record for that worker on that day.
export default function MissingAttendanceList({ items }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
      <p className="px-4 py-2 text-sm font-bold text-amber-800 flex items-center gap-1.5"><CalendarX className="w-4 h-4" />משמרת מתוכננת ללא נוכחות ({items.length})</p>
      <div className="divide-y divide-amber-200">
        {items.map((s) => (
          <div key={s.id} className="px-4 py-2 text-sm flex justify-between gap-2">
            <span className="font-semibold">{s.worker_name || "עובד"}</span>
            <span className="text-amber-800">{s.row_label} {s.start_time && <span dir="ltr">{s.start_time}–{s.end_time}</span>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}