import VscEvent from "./VscEvent";
import { eventEnd, freeAgainAt, busyIntervals, blockRangeOnDay } from "@/lib/spaceCalendarView";

const MAX_CHIPS = 3;

export default function VscWeekCell({ space, events, blocks, date, onOpenDay }) {
  const intervals = busyIntervals(events, blocks, date);
  const dayBlocks = blocks.filter(b => blockRangeOnDay(b, date));
  const shown = events.slice(0, MAX_CHIPS);
  return (
    <div className="vsc-cell">
      {!space.available && <div className="vsc-cell-closed vsc-blocked" title={space.unavailable_label}>{space.unavailable_label}</div>}
      {space.available && dayBlocks.map(b => (
        <div key={b.id} className="vsc-cell-closed vsc-blocked" title={b.reason_label}>{b.reason_label}</div>
      ))}
      {shown.map(event => (
        <VscEvent key={event.id} event={event} spaceName={space.name} freeAgain={freeAgainAt(intervals, eventEnd(event) - 1)} className="vsc-chip">
          <span className="vsc-chip-title">{event.status === "PENDING" ? "⏳ " : ""}{event.title}</span>
          <span className="vsc-chip-time">{event.start_time}–{event.end_time}{event.status === "PENDING" ? " · ממתין" : ""}</span>
        </VscEvent>
      ))}
      {events.length > MAX_CHIPS && (
        <button type="button" className="vsc-more" onClick={() => onOpenDay(date)}>+{events.length - MAX_CHIPS} נוספים</button>
      )}
    </div>
  );
}