import { useMemo, useState } from "react";
import { Loader2, CalendarRange, DoorOpen } from "lucide-react";
import useSpaceCalendar from "@/hooks/useSpaceCalendar";
import { sortActivitySpaces } from "@/lib/activitySpaceUtils";
import { GROUP_TYPE_LABELS, addDays, israelNow, weekDates, toneFor, busyIntervals, statusAt } from "@/lib/spaceCalendarView";
import VscToolbar from "./VscToolbar";
import VscFilters from "./VscFilters";
import VscLegend from "./VscLegend";
import VscDayTimeline from "./VscDayTimeline";
import VscWeekGrid from "./VscWeekGrid";
import "./visualSpaceCalendar.css";

// Shared, read-only visual calendar of common spaces (used by admins and VIEWER).
export default function VisualSpaceCalendar() {
  const now = israelNow();
  const [mode, setMode] = useState("day");
  const [date, setDate] = useState(now.date);
  const [filters, setFilters] = useState({ space: "all", group: "all", type: "all" });
  const week = weekDates(date);
  const { data, isLoading, error } = useSpaceCalendar(week[0], week[6]);

  const allSpaces = useMemo(() => sortActivitySpaces(data?.spaces || []), [data]);
  const allEvents = useMemo(() => (data?.events || []).map(e => ({ ...e, tone: toneFor(e) })), [data]);
  const options = useMemo(() => {
    const groupMap = new Map();
    allEvents.forEach(e => e.group_ids.forEach((id, i) => groupMap.set(id, e.group_names[i])));
    return {
      spaces: [{ value: "all", label: "כל המרחבים" }, ...allSpaces.map(s => ({ value: s.id, label: s.name }))],
      groups: [{ value: "all", label: "כל הקבוצות" }, ...[...groupMap].sort((a, b) => a[1].localeCompare(b[1], "he")).map(([value, label]) => ({ value, label }))],
      types: [{ value: "all", label: "כל הסוגים" }, ...Object.entries(GROUP_TYPE_LABELS).map(([value, label]) => ({ value, label }))],
    };
  }, [allEvents, allSpaces]);

  const spaces = filters.space === "all" ? allSpaces : allSpaces.filter(s => s.id === filters.space);
  const events = allEvents.filter(e => (filters.group === "all" || e.group_ids.includes(filters.group)) && (filters.type === "all" || e.group_type === filters.type));
  const blocks = data?.blocks || [];

  const freeNow = useMemo(() => allSpaces.filter(s => {
    const se = allEvents.filter(e => e.space_id === s.id && e.date === now.date);
    return statusAt(s, busyIntervals(se, blocks.filter(b => b.space_id === s.id), now.date), now.minutes).kind === "free";
  }), [allSpaces, allEvents, blocks, now.date, now.minutes]);

  const openDay = (d) => { setDate(d); setMode("day"); };

  return (
    <div className="vsc-root space-y-3" dir="rtl">
      <VscToolbar mode={mode} date={date} onMode={setMode} onToday={() => setDate(israelNow().date)} onDate={setDate}
        onShift={(dir) => setDate(d => addDays(d, dir * (mode === "day" ? 1 : 7)))} />
      <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-border bg-card p-2">
        <VscFilters groups={options} filters={filters} onChange={setFilters} />
        {data && week.includes(now.date) && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent" title={freeNow.map(s => s.name).join(", ")}>
            <DoorOpen className="w-4 h-4" /> פנויים עכשיו: {freeNow.length} מתוך {allSpaces.length}
          </span>
        )}
      </div>
      <VscLegend />
      {isLoading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> טוען יומן מרחבים…</div>}
      {error && <div className="rounded-lg border border-destructive bg-card p-4 text-sm text-destructive">{error.message}</div>}
      {data && mode === "day" && <VscDayTimeline spaces={spaces} events={events} blocks={blocks} date={date} now={now} />}
      {data && mode === "week" && <VscWeekGrid spaces={spaces} events={events} blocks={blocks} date={date} now={now} onOpenDay={openDay} />}
      {data && mode === "week" && <p className="text-xs text-muted-foreground flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" /> לחיצה על יום מציגה את השעות המדויקות.</p>}
    </div>
  );
}