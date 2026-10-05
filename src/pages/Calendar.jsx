import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import moment from "moment";
import "moment/locale/he";
import { ChevronLeft, ChevronRight, CalendarDays, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";
import CheckInOutCalendar from "../components/calendar/CheckInOutCalendar.jsx";
import OperationalDaySummary from "../components/calendar/OperationalDaySummary.jsx";
import { getWeekDatesSunday, getMonthDatesSunday, HEB_DAYS_SUN } from "@/lib/calendarWeek";
import { classifyGroupsForDate } from "@/lib/groupDateReaders";
import useGroupStayPeriods from "@/hooks/useGroupStayPeriods";

moment.locale("he");

const fmt = (d) => moment(d).format("YYYY-MM-DD");
const fmtDay = (d) => moment(d).format("YYYY-MM-DD");
const todayStr = fmt(moment());
const EXCLUDED_STATUSES = new Set(["CANCELLED", "COMPLETED", "ARCHIVED"]);

const MEAL_TYPE_HEB = { BREAKFAST: "בוקר", LUNCH: "צהריים", DINNER: "ערב", COFFEE_CORNER: "קפה", OTHER: "אחר" };
const MEAL_ORDER = { BREAKFAST: 0, LUNCH: 1, DINNER: 2, COFFEE_CORNER: 3, OTHER: 4 };

// ─── Compact day summary helpers ─────────────────────────────────────────────

const isDayUse = (g) => g.group_type === "DAY_USE";

function getDaySummary(dateStr, groups, meals, activities, periodsByGroupId = {}) {
  const operationalGroupIds = new Set(groups.map((group) => group.id));
  const activeGroups = groups.filter((g) => !EXCLUDED_STATUSES.has(g.status) && g.arrival_date && g.departure_date);
  // Lodging check-ins/outs/staying — period-aware for MULTI_PERIOD groups
  const lodgingGroups = activeGroups.filter((g) => !isDayUse(g));
  const { arrivals: checkins, departures: checkouts, staying } = classifyGroupsForDate(lodgingGroups, dateStr, periodsByGroupId);
  // Day-use groups active today
  const dayUseGroups = activeGroups.filter((g) => isDayUse(g) && fmtDay(g.arrival_date) === dateStr);
  const onSite = [...checkins, ...staying];
  const totalPax = [...onSite, ...dayUseGroups].reduce((s, g) => s + (Number(g.total_pax) || 0), 0);

  const dayMeals = meals.filter((m) => operationalGroupIds.has(m.group_id) && m.status === "ACTIVE" && m.date === dateStr && m.meal_type !== "COFFEE_CORNER");
  const mealsByType = {};
  dayMeals.forEach((m) => {
    const t = m.meal_type || "OTHER";
    if (!mealsByType[t]) mealsByType[t] = { count: 0, pax: 0 };
    mealsByType[t].count++;
    mealsByType[t].pax += Number(m.pax) || 0;
  });

  const dayActivities = activities.filter((i) => (i.standalone || operationalGroupIds.has(i.group_id)) && i.status === "ACTIVE" && i.date === dateStr);

  return { checkins, checkouts, staying, dayUseGroups, onSite, totalPax, mealsByType, dayMeals, dayActivities };
}

// ─── Compact Month Day Cell ───────────────────────────────────────────────────

function MonthDayCell({ date, groups, meals, activities, periodsByGroupId, onClick, isCurrentMonth }) {
  const dateStr = fmt(date);
  const isToday = dateStr === todayStr;
  const { checkins, checkouts, dayUseGroups, onSite, totalPax, mealsByType, dayActivities } = getDaySummary(dateStr, groups, meals, activities, periodsByGroupId);
  const allOnDay = [...onSite, ...dayUseGroups];

  const hasContent = allOnDay.length > 0 || Object.keys(mealsByType).length > 0 || dayActivities.length > 0;

  return (
    <button
      type="button"
      onClick={() => onClick(date)}
      className={cn(
        "min-h-[110px] p-2 flex flex-col gap-1 border-b border-r border-slate-200 text-right w-full transition-colors",
        isCurrentMonth ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100/60",
        isToday && "ring-1 ring-inset ring-primary/40"
      )}>
      
      {/* Day number */}
      <span className={cn(
        "text-xs font-semibold leading-none mb-0.5 self-end",
        isToday ?
        "bg-primary text-white w-5 h-5 rounded-full flex items-center justify-center text-[11px]" :
        isCurrentMonth ? "text-slate-600" : "text-slate-300"
      )}>
        {date.format("D")}
      </span>

      {!hasContent &&
      <span className="text-[11px] text-slate-200 leading-tight">—</span>
      }

      {/* Groups on site */}
      {allOnDay.length > 0 &&
      <div className="flex items-center gap-1 flex-wrap">
          {checkins.length > 0 &&
        <span className="text-[11px] font-bold bg-emerald-500 text-white rounded px-1.5 py-0.5 leading-none">
              ↓{checkins.length}
            </span>
        }
          {checkouts.length > 0 &&
        <span className="text-[11px] font-bold bg-orange-500 text-white rounded px-1.5 py-0.5 leading-none">
              ↑{checkouts.length}
            </span>
        }
          {dayUseGroups.length > 0 &&
        <span className="text-[11px] font-bold bg-teal-500 rounded px-1.5 py-0.5 leading-none text-[hsl(var(--popover))]">
              ☀{dayUseGroups.length}
            </span>
        }
          <span className="text-[11px] text-slate-500 font-medium">{allOnDay.length} קבוצות</span>
        </div>
      }

      {/* Pax */}
      {totalPax > 0 &&
      <span className="text-[11px] text-slate-400 leading-none">{totalPax} 👤</span>
      }

      {/* Meals summary */}
      {Object.keys(mealsByType).length > 0 &&
      <div className="flex flex-wrap gap-1">
          {Object.entries(mealsByType).
        sort(([a], [b]) => (MEAL_ORDER[a] ?? 99) - (MEAL_ORDER[b] ?? 99)).
        map(([type, { pax }]) =>
        <span key={type} className="text-[11px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 leading-none font-medium">
                {MEAL_TYPE_HEB[type] || type} {pax > 0 ? pax : ""}
              </span>
        )}
        </div>
      }

      {/* Activities count */}
      {dayActivities.length > 0 &&
      <span className="text-[11px] bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 leading-none font-medium">
          {dayActivities.length} פעילויות
        </span>
      }
    </button>);

}

function MonthView({ dates, groups, meals, activities, periodsByGroupId, pivot, onClick }) {
  const currentMonth = pivot.month();
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
        {HEB_DAYS_SUN.map((d) =>
        <div key={d} className="text-center text-xs font-semibold text-slate-500 py-3 border-r border-slate-200">
            {d}
          </div>
        )}
      </div>
      {Array.from({ length: dates.length / 7 }, (_, wi) =>
      <div key={wi} className="grid grid-cols-7">
          {dates.slice(wi * 7, wi * 7 + 7).map((date) =>
        <MonthDayCell
          key={date.toISOString()}
          date={date}
          groups={groups}
          meals={meals}
          activities={activities}
          periodsByGroupId={periodsByGroupId}
          onClick={onClick}
          isCurrentMonth={date.month() === currentMonth} />

        )}
        </div>
      )}
    </div>);

}

// ─── Compact Week Day Column ──────────────────────────────────────────────────

function WeekDayColumn({ date, groups, meals, activities, periodsByGroupId, onClick }) {
  const dateStr = fmt(date);
  const isToday = dateStr === todayStr;
  const { checkins, checkouts, staying, dayUseGroups, onSite, totalPax, mealsByType, dayActivities } = getDaySummary(dateStr, groups, meals, activities, periodsByGroupId);
  const allOnDay = [...onSite, ...dayUseGroups];

  const hasContent = allOnDay.length > 0 || Object.keys(mealsByType).length > 0 || dayActivities.length > 0;

  return (
    <button
      type="button"
      onClick={() => onClick(date)}
      className={cn(
        "flex flex-col min-h-[260px] border-r border-slate-200 text-right w-full transition-colors",
        isToday ? "bg-primary/5 hover:bg-primary/10" : "bg-white hover:bg-slate-50"
      )}>
      
      {/* Day header */}
      <div className={cn(
        "px-2 py-3 border-b text-center w-full",
        isToday ? "bg-primary text-white border-primary/30" : "bg-slate-50 border-slate-200 text-slate-600"
      )}>
        <div className={cn("text-[11px] font-semibold uppercase tracking-wide", isToday ? "text-white/80" : "text-slate-400")}>
          {date.format("dddd")}
        </div>
        <div className={cn("text-2xl font-bold leading-tight mt-0.5", isToday ? "text-white" : "text-slate-800")}>
          {date.format("D")}
        </div>
        <div className={cn("text-[10px] mt-0.5", isToday ? "text-white/70" : "text-slate-400")}>
          {date.format("MMM")}
        </div>
      </div>

      {/* Summary content */}
      <div className="flex-1 p-2.5 flex flex-col gap-2">
        {!hasContent &&
        <div className="flex items-center justify-center h-full text-slate-200 text-xs mt-4">—</div>
        }

        {/* Groups */}
        {allOnDay.length > 0 &&
        <div className="space-y-1">
            {/* Movement badges */}
            <div className="flex flex-wrap gap-1">
              {checkins.length > 0 &&
            <span className="text-xs font-bold bg-emerald-500 text-white rounded px-1.5 py-0.5 leading-none">
                  ↓ צ׳ק-אין {checkins.length}
                </span>
            }
              {checkouts.length > 0 &&
            <span className="text-xs font-bold bg-orange-500 text-white rounded px-1.5 py-0.5 leading-none">
                  ↑ צ׳ק-אאוט {checkouts.length}
                </span>
            }
              {dayUseGroups.length > 0 &&
            <span className="text-xs font-bold bg-teal-500 text-white rounded px-1.5 py-0.5 leading-none">
                  ☀ באי יום {dayUseGroups.length}
                </span>
            }
            </div>
            {/* On site summary */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-right">
              <p className="text-xs font-semibold text-slate-600">{allOnDay.length} קבוצות באתר</p>
              {onSite.length > 0 && dayUseGroups.length > 0 &&
            <p className="text-[11px] text-slate-400">לינה: {onSite.length} · באי יום: {dayUseGroups.length}</p>
            }
              {totalPax > 0 && <p className="text-xs text-slate-400">{totalPax} אורחים</p>}
            </div>
          </div>
        }

        {/* Meals */}
        {Object.keys(mealsByType).length > 0 &&
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 space-y-0.5">
            {Object.entries(mealsByType).
          sort(([a], [b]) => (MEAL_ORDER[a] ?? 99) - (MEAL_ORDER[b] ?? 99)).
          map(([type, { pax, count }]) =>
          <div key={type} className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-amber-700">{MEAL_TYPE_HEB[type] || type}</span>
                    <span className="text-xs text-amber-600">{pax > 0 ? `${pax} 🍽` : `${count}`}</span>
                  </div>
          )}
              </div>
        }

              {/* Activities */}
              {dayActivities.length > 0 &&
        <div className="bg-purple-50 border border-purple-100 rounded-lg px-2 py-1.5">
              <p className="text-xs font-semibold text-purple-700">{dayActivities.length} פעילויות</p>
              </div>
        }
      </div>
    </button>);

}

function WeekView({ dates, groups, meals, activities, periodsByGroupId, onClick }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="grid grid-cols-7">
        {dates.map((date) =>
        <WeekDayColumn
          key={date.toISOString()}
          date={date}
          groups={groups}
          meals={meals}
          activities={activities}
          periodsByGroupId={periodsByGroupId}
          onClick={onClick} />

        )}
      </div>
    </div>);

}

// ─── Mobile Agenda View ───────────────────────────────────────────────────────

function AgendaView({ pivot, groups, meals, activities, periodsByGroupId, onDayClick, onPrev, onNext, onToday }) {
  const dateStr = fmt(pivot);
  const isToday = dateStr === todayStr;
  const dayLabel = pivot.format("dddd, D בMMMM YYYY");
  const { checkins, checkouts, staying, dayUseGroups, onSite, totalPax, mealsByType, dayActivities } = getDaySummary(dateStr, groups, meals, activities, periodsByGroupId);
  const allOnDay = [...onSite, ...dayUseGroups];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={onPrev} className="flex-1 flex items-center justify-center gap-1 h-10 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50">
          <ChevronRight className="w-4 h-4" /> יום קודם
        </button>
        <button onClick={onToday} className={cn(
          "h-10 px-3 rounded-xl border text-sm font-bold transition-colors",
          isToday ? "bg-primary text-white border-primary" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
        )}>היום</button>
        <button onClick={onNext} className="flex-1 flex items-center justify-center gap-1 h-10 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50">
          יום הבא <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onDayClick(pivot)}
        className={cn(
          "w-full text-center py-3 rounded-xl font-bold text-base transition-colors",
          isToday ? "bg-primary/10 text-primary hover:bg-primary/20" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
        )}>
        
        {dayLabel}
        {isToday && <span className="mr-2 text-sm font-normal">— היום</span>}
      </button>

      {/* Quick summary for mobile */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
        {onSite.length === 0 && Object.keys(mealsByType).length === 0 && dayActivities.length === 0 &&
        <p className="text-sm text-slate-400 text-center py-4">אין אירועים ביום זה</p>
        }
        {allOnDay.length > 0 &&
        <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">{allOnDay.length} קבוצות באתר{totalPax > 0 ? ` · ${totalPax} אורחים` : ""}</span>
              <div className="flex gap-1">
                {checkins.length > 0 && <span className="text-[10px] bg-emerald-500 text-white rounded px-1.5 py-0.5 font-bold">↓{checkins.length}</span>}
                {checkouts.length > 0 && <span className="text-[10px] bg-orange-500 text-white rounded px-1.5 py-0.5 font-bold">↑{checkouts.length}</span>}
                {dayUseGroups.length > 0 && <span className="text-[10px] bg-teal-500 text-white rounded px-1.5 py-0.5 font-bold">☀{dayUseGroups.length}</span>}
              </div>
            </div>
            {onSite.length > 0 && dayUseGroups.length > 0 &&
          <p className="text-[11px] text-slate-400">לינה: {onSite.length} · באי יום: {dayUseGroups.length}</p>
          }
          </div>
        }
        {Object.keys(mealsByType).length > 0 &&
        <div className="flex flex-wrap gap-1">
            {Object.entries(mealsByType).
          sort(([a], [b]) => (MEAL_ORDER[a] ?? 99) - (MEAL_ORDER[b] ?? 99)).
          map(([type, { pax }]) =>
          <span key={type} className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">
                  {MEAL_TYPE_HEB[type]} {pax > 0 ? pax : ""}
                </span>
          )}
          </div>
        }
        {dayActivities.length > 0 &&
        <span className="text-[10px] bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 font-medium inline-block">
            {dayActivities.length} פעילויות
          </span>
        }
        {(onSite.length > 0 || Object.keys(mealsByType).length > 0 || dayActivities.length > 0) &&
        <p className="text-[10px] text-slate-400 text-center mt-1">לחץ על התאריך לפרטים מלאים</p>
        }
      </div>
    </div>);

}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 bg-white border border-slate-100 rounded-lg px-4 py-2">
      <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" /> צ׳ק-אין</div>
      <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-orange-500 inline-block" /> צ׳ק-אאוט</div>
      <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-300 inline-block" /> שוהים</div>
      <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-teal-500 inline-block" /> באי יום</div>
      <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-400 inline-block" /> ארוחות</div>
      <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-purple-500 inline-block" /> פעילויות</div>
    </div>);

}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════════

export default function Calendar() {
  const [pivot, setPivot] = useState(moment());
  const [view, setView] = useState("week");
  const [selectedDate, setSelectedDate] = useState(null); // moment object — for day summary
  const [tab, setTab] = useState("operational"); // "operational" | "checkinout"

  const { data: groups = [] } = useQuery({
    queryKey: ["cal-groups"],
    queryFn: () => base44.entities.Group.list("-arrival_date", 500),
    select: items => items.filter(isGroupOperationallyEnabled),
  });
  const { data: meals = [] } = useQuery({
    queryKey: ["cal-meals"],
    queryFn: () => base44.entities.MealReservation.filter({ status: "ACTIVE" })
  });
  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["cal-schedule"],
    queryFn: () => base44.entities.GroupScheduleItem.filter({ status: "ACTIVE" })
  });
  const { data: standaloneActivities = [] } = useQuery({
    queryKey: ["standaloneActivities"],
    queryFn: () => base44.entities.StandaloneActivityReservation.filter({ status: "ACTIVE" })
  });
  const { data: standaloneAssignments = [] } = useQuery({
    queryKey: ["standaloneActivityAssignments"],
    queryFn: () => base44.entities.StandaloneActivitySpaceAssignment.list("-created_date", 500)
  });
  const { data: activitySpaces = [] } = useQuery({
    queryKey: ["cal-spaces"],
    queryFn: () => base44.entities.ActivitySpace.list()
  });
  const { data: alerts = [] } = useQuery({
    queryKey: ["cal-alerts"],
    queryFn: () => base44.entities.OperationalReviewAlert.filter({ status: "OPEN" })
  });
  const { data: coffeeRequests = [] } = useQuery({
    queryKey: ["cal-coffee"],
    queryFn: () => base44.entities.CoffeeCornerRequest.filter({ status: "ACTIVE" })
  });
  const { data: prisaRequests = [] } = useQuery({
    queryKey: ["cal-prisa"],
    queryFn: () => base44.entities.PrisaRequest.filter({ status: "ACTIVE" })
  });

  const { periodsByGroupId } = useGroupStayPeriods(groups);
  const operationalGroupIds = useMemo(() => new Set(groups.map(g => g.id)), [groups]);
  const operationalMeals = useMemo(() => meals.filter(m => operationalGroupIds.has(m.group_id)), [meals, operationalGroupIds]);
  const standaloneAssignmentsByReservation = useMemo(() => {
    const map = {};
    standaloneAssignments.forEach((item) => (map[item.reservation_id] ||= []).push(item));
    return map;
  }, [standaloneAssignments]);
  const operationalScheduleItems = useMemo(() => {
    const groupItems = scheduleItems.filter(i => operationalGroupIds.has(i.group_id));
    const standaloneItems = standaloneActivities.map((activity) => {
      const assignments = standaloneAssignmentsByReservation[activity.id] || [];
      return { ...activity, standalone: true, date: activity.event_date, activity_name: activity.title, pax: activity.expected_pax, notes: [activity.preparation_notes, activity.general_notes].filter(Boolean).join(" · "), activity_space_id: assignments[0]?.activity_space_id || null, space_ids: assignments.map((item) => item.activity_space_id), needs_projector: assignments.some((item) => item.needs_projector), needs_screen: assignments.some((item) => item.needs_screen), needs_microphone: assignments.some((item) => item.needs_microphone), needs_sound: assignments.some((item) => item.needs_sound), needs_whiteboard: assignments.some((item) => item.needs_whiteboard), needs_chair_circle: assignments.some((item) => item.needs_chair_circle), chairs_count: Math.max(0, ...assignments.map((item) => Number(item.chairs_count) || 0)), logistics_other: assignments.map((item) => item.logistics_other).filter(Boolean).join(", ") };
    });
    return [...groupItems, ...standaloneItems];
  }, [scheduleItems, standaloneActivities, standaloneAssignmentsByReservation, operationalGroupIds]);
  const operationalAlerts = useMemo(() => alerts.filter(a => operationalGroupIds.has(a.group_id)), [alerts, operationalGroupIds]);
  const operationalCoffee = useMemo(() => coffeeRequests.filter(r => operationalGroupIds.has(r.group_id)), [coffeeRequests, operationalGroupIds]);
  const operationalPrisa = useMemo(() => prisaRequests.filter(r => operationalGroupIds.has(r.group_id)), [prisaRequests, operationalGroupIds]);

  const dates = useMemo(
    () => view === "week" ? getWeekDatesSunday(pivot) : getMonthDatesSunday(pivot),
    [pivot, view]
  );

  const go = (dir) => setPivot((p) => p.clone().add(dir, view === "week" ? "week" : "month"));
  const goAgendaDay = (dir) => setPivot((p) => p.clone().add(dir, "day"));
  const goToday = () => setPivot(moment());

  const titleStr = view === "week" ?
  `${dates[0].format("D MMM")} – ${dates[6].format("D MMM YYYY")}` :
  pivot.format("MMMM YYYY");

  const handleDayClick = (date) => setSelectedDate(date);

  return (
    <div className="min-h-screen bg-background" dir="rtl">

      {/* ── MOBILE ───────────────────────────────────────────────────── */}
      <div className="sm:hidden px-4 py-4 space-y-4">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-primary" />
          לוח שנה תפעולי
        </h1>
        <div className="flex gap-1 overflow-x-auto pb-1">
          <Button size="sm" variant={tab === "operational" ? "default" : "outline"} onClick={() => setTab("operational")} className="shrink-0 text-xs">לוח תפעולי</Button>
          <Button size="sm" variant={tab === "checkinout" ? "default" : "outline"} onClick={() => setTab("checkinout")} className="shrink-0 text-xs">צ׳ק אין / אאוט</Button>
        </div>
        {tab === "operational" &&
        <AgendaView
          pivot={pivot}
          groups={groups}
          meals={operationalMeals}
          activities={operationalScheduleItems}
          periodsByGroupId={periodsByGroupId}
          onDayClick={handleDayClick}
          onPrev={() => goAgendaDay(-1)}
          onNext={() => goAgendaDay(1)}
          onToday={goToday} />

        }
        {tab === "checkinout" && <CheckInOutCalendar />}
      </div>

      {/* ── DESKTOP ──────────────────────────────────────────────────── */}
      <div className="hidden sm:block max-w-[1400px] mx-auto px-3 sm:px-6 py-6 space-y-4">

        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            לוח שנה תפעולי
          </h1>
          <p className="text-sm text-muted-foreground">לחץ על יום לסיכום תפעולי מפורט</p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 border-b border-slate-200 pb-1">
          <Button size="sm" variant={tab === "operational" ? "default" : "ghost"}
          onClick={() => setTab("operational")} className="gap-1.5">
            <CalendarDays className="w-4 h-4" /> לוח תפעולי
          </Button>
          <Button size="sm" variant={tab === "checkinout" ? "default" : "ghost"}
          onClick={() => setTab("checkinout")} className="gap-1.5">
            <Users className="w-4 h-4" /> צ׳ק אין / צ׳ק אאוט
          </Button>
        </div>

        {tab === "operational" &&
        <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => go(-1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={goToday} className="px-3">היום</Button>
                <Button size="sm" variant="outline" onClick={() => go(1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-base font-bold text-slate-700 mr-2">{titleStr}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant={view === "week" ? "default" : "outline"} onClick={() => setView("week")}>שבוע</Button>
                <Button size="sm" variant={view === "month" ? "default" : "outline"} onClick={() => setView("month")}>חודש</Button>
              </div>
            </div>

            <Legend />

            {view === "week" ?
          <WeekView dates={dates} groups={groups} meals={operationalMeals} activities={operationalScheduleItems} periodsByGroupId={periodsByGroupId} onClick={handleDayClick} /> :

          <MonthView dates={dates} groups={groups} meals={operationalMeals} activities={operationalScheduleItems} periodsByGroupId={periodsByGroupId} pivot={pivot} onClick={handleDayClick} />
          }
          </>
        }

        {tab === "checkinout" && <CheckInOutCalendar />}
      </div>

      {/* Day summary modal */}
      <OperationalDaySummary
        date={selectedDate}
        isOpen={!!selectedDate}
        onClose={() => setSelectedDate(null)}
        onNavigateDate={(newDate) => setSelectedDate(newDate)}
        allGroups={groups}
        allMeals={operationalMeals}
        allActivities={operationalScheduleItems}
        allSpaces={activitySpaces}
        allAlerts={operationalAlerts}
        allCoffeeRequests={operationalCoffee}
        allPrisaRequests={operationalPrisa} />
      
    </div>);

}