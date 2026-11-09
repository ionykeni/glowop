import VscEvent from "./VscEvent";
import { layoutLanes, toMin, eventEnd, fmtMin, freeAgainAt, statusAt, blockRangeOnDay } from "@/lib/spaceCalendarView";

const LANE_H = 44;

export default function VscDayRow({ space, events, blocks, intervals, window: win, hours, nowMin, date }) {
  const span = win[1] - win[0];
  const pos = (s, e) => {
    const a = Math.max(s, win[0]), b = Math.min(e, win[1]);
    return { right: `${((a - win[0]) / span) * 100}%`, width: `${Math.max(((b - a) / span) * 100, 0.6)}%` };
  };
  const { placed, lanes } = layoutLanes(events);
  const status = nowMin != null ? statusAt(space, intervals, nowMin) : (!space.available ? { kind: "closed", label: space.unavailable_label } : null);
  return (
    <div className="vsc-tl-row">
      <div className="vsc-tl-head">
        <div className="vsc-tl-name" title={space.name}>{space.name}</div>
        {status && <span className={`vsc-status vsc-status--${status.kind}`}>{status.label}</span>}
      </div>
      <div className="vsc-tl-track" style={{ height: lanes * LANE_H + 8 }}>
        {hours.map(h => <span key={h} className="vsc-tl-hour" style={{ right: `${((h - win[0]) / span) * 100}%` }} />)}
        {!space.available && <div className="vsc-closed-track vsc-blocked">{space.unavailable_label}</div>}
        {space.available && blocks.map(b => {
          const r = blockRangeOnDay(b, date);
          if (!r || r[1] <= win[0] || r[0] >= win[1]) return null;
          return <div key={b.id} className="vsc-block vsc-blocked" style={pos(r[0], r[1])} title={`${b.reason_label} · ${fmtMin(r[0])}–${fmtMin(r[1] >= 1440 ? 0 : r[1])}`}>{b.reason_label}</div>;
        })}
        {placed.map(({ event, lane }) => (
          <VscEvent
            key={event.id}
            event={event}
            spaceName={space.name}
            freeAgain={freeAgainAt(intervals, eventEnd(event) - 1) }
            className="vsc-ev"
            style={{ ...pos(toMin(event.start_time), eventEnd(event)), top: 4 + lane * LANE_H, height: LANE_H - 4 }}
          >
            <span className="vsc-ev-title">{event.title}{event.status === "PENDING" && <span className="vsc-pending-tag">ממתין</span>}</span>
            <span className="vsc-ev-sub">{event.start_time}–{event.end_time} · {event.group_names.join(", ") || "פעילות כללית"}</span>
          </VscEvent>
        ))}
        {nowMin != null && nowMin >= win[0] && nowMin <= win[1] && <span className="vsc-now" style={{ right: `${((nowMin - win[0]) / span) * 100}%` }} />}
      </div>
    </div>
  );
}