import { useMemo } from "react";
import VscDayRow from "./VscDayRow";
import { toMin, eventEnd, busyIntervals } from "@/lib/spaceCalendarView";

// Daily resource timeline: one row per space, real clock hours on the horizontal axis (RTL).
export default function VscDayTimeline({ spaces, events, blocks, date, now }) {
  const dayEvents = useMemo(() => events.filter(e => e.date === date), [events, date]);
  const win = useMemo(() => {
    let s = 7 * 60, e = 23 * 60;
    dayEvents.forEach(ev => { s = Math.min(s, toMin(ev.start_time)); e = Math.max(e, eventEnd(ev)); });
    return [Math.floor(s / 60) * 60, Math.min(1440, Math.ceil(e / 60) * 60)];
  }, [dayEvents]);
  const hours = [];
  for (let m = win[0]; m < win[1]; m += 60) hours.push(m);
  const nowMin = now.date === date ? now.minutes : null;
  const span = win[1] - win[0];

  return (
    <div className="vsc-timeline">
      <div className="vsc-tl-inner">
        <div className="vsc-tl-row vsc-tl-axis">
          <div className="vsc-tl-head text-[11px] text-muted-foreground">מרחב</div>
          <div className="vsc-tl-track">
            {hours.map(h => (
              <span key={h}>
                <span className="vsc-tl-hour" style={{ right: `${((h - win[0]) / span) * 100}%` }} />
                <span className="vsc-tl-axis-label" style={{ right: `${((h - win[0]) / span) * 100}%` }}>{String(h / 60).padStart(2, "0")}:00</span>
              </span>
            ))}
          </div>
        </div>
        {spaces.map(space => {
          const se = dayEvents.filter(e => e.space_id === space.id);
          const sb = blocks.filter(b => b.space_id === space.id);
          return (
            <VscDayRow key={space.id} space={space} events={se} blocks={sb} intervals={busyIntervals(se, sb, date)}
              window={win} hours={hours} nowMin={nowMin} date={date} />
          );
        })}
        {spaces.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">אין מרחבים להצגה</p>}
      </div>
    </div>
  );
}