/**
 * ChronologicalDayView
 * Shows all operational events for a selected day sorted by time, regardless of group.
 * Events are NOT grouped by group — they are sorted only by their start time.
 *
 * Event sources:
 * - Group arrivals (arrival_date + arrival_time)
 * - Group departures (departure_date + departure_time)
 * - MealReservation (date + start_time)
 * - CoffeeCornerRequest (date + start_time)
 * - GroupScheduleItem / activities (date + start_time)
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownCircle, ArrowUpCircle, UtensilsCrossed, CalendarDays, Sun, Coffee, Sandwich } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActivityEquipmentLine } from "@/components/schedule/LogisticsFields";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";
import { PRISA_TYPE_LABELS, PRISA_SLOT_LABELS, PRISA_SLOT_ORDER } from "@/lib/prisaLabels";

const EXCLUDED = new Set(["CANCELLED", "COMPLETED", "ARCHIVED"]);

const COFFEE_TYPE_LABELS = {
  "פינת קפה רגילה": "רגילה",
  "פינת קפה ועוגיות": "עם עוגיות",
  "פינת קפה ומאפה": "עם מאפה",
  "HOT_WATER_THERMOCAN_ONLY": "מים חמים / תרמוס",
};
const coffeeTypeLabel = (value) => COFFEE_TYPE_LABELS[value] || value || null;

const MEAL_TYPE_HEB = {
  BREAKFAST: "ארוחת בוקר",
  LUNCH: "ארוחת צהריים",
  DINNER: "ארוחת ערב",
  COFFEE_CORNER: "פינת קפה",
  OTHER: "ארוחה",
};

const fmt = (d) => {
  if (!d) return "";
  const s = typeof d === "string" ? d : d.toISOString();
  return s.split("T")[0];
};

// ── Type config: icon, colors, label ─────────────────────────────────────────
const TYPE_CONFIG = {
  arrival: {
    label: "הגעה",
    Icon: ArrowDownCircle,
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    badge: "bg-emerald-100 text-emerald-700",
    time_color: "text-emerald-700",
  },
  departure: {
    label: "עזיבה",
    Icon: ArrowUpCircle,
    bg: "bg-orange-50",
    border: "border-orange-200",
    badge: "bg-orange-100 text-orange-700",
    time_color: "text-orange-700",
  },
  dayuse: {
    label: "באי יום",
    Icon: Sun,
    bg: "bg-teal-50",
    border: "border-teal-200",
    badge: "bg-teal-100 text-teal-700",
    time_color: "text-teal-700",
  },
  meal: {
    label: "ארוחה",
    Icon: UtensilsCrossed,
    bg: "bg-amber-50",
    border: "border-amber-200",
    badge: "bg-amber-100 text-amber-700",
    time_color: "text-amber-700",
  },
  coffee: {
    label: "פינת קפה",
    Icon: Coffee,
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    badge: "bg-yellow-100 text-yellow-700",
    time_color: "text-yellow-700",
  },
  activity: {
    label: "פעילות",
    Icon: CalendarDays,
    bg: "bg-purple-50",
    border: "border-purple-200",
    badge: "bg-purple-100 text-purple-700",
    time_color: "text-purple-700",
  },
  prisa: {
    label: "פריסה",
    Icon: Sandwich,
    bg: "bg-orange-50",
    border: "border-orange-200",
    badge: "bg-orange-100 text-orange-700",
    time_color: "text-orange-700",
  },
};

// ── Build normalized chronological events ─────────────────────────────────────
export function buildChronologicalDayEvents({ dateStr, allGroups, allMeals, allActivities, allCoffeeRequests, allPrisaRequests, activeCoffeeKeys }) {
  const events = [];
  const operationalGroupIds = new Set((allGroups || []).filter(isGroupOperationallyEnabled).map(g => g.id));

  // 1. Group arrivals & departures
  (allGroups || [])
    .filter(g => isGroupOperationallyEnabled(g) && !EXCLUDED.has(g.status) && g.arrival_date)
    .forEach(g => {
      const isDayUse = g.group_type === "DAY_USE";

      if (isDayUse) {
        // Day-use: single "arrival" event on arrival_date
        if (fmt(g.arrival_date) === dateStr) {
          events.push({
            id: `dayuse-${g.id}`,
            type: "dayuse",
            time: g.arrival_time || null,
            end_time: g.departure_time || null,
            group_id: g.id,
            group_name: g.group_name,
            title: "באי יום",
            location: null,
            pax: g.total_pax || null,
            details: g.arrival_time && g.departure_time ? `${g.arrival_time}–${g.departure_time}` : null,
            source_entity: "Group",
            source_id: g.id,
          });
        }
      } else {
        // Lodging: arrival
        if (fmt(g.arrival_date) === dateStr) {
          events.push({
            id: `arrival-${g.id}`,
            type: "arrival",
            time: g.arrival_time || null,
            end_time: null,
            group_id: g.id,
            group_name: g.group_name,
            title: "הגעה",
            location: null,
            pax: g.total_pax || null,
            details: null,
            source_entity: "Group",
            source_id: g.id,
          });
        }
        // Lodging: departure
        if (g.departure_date && fmt(g.departure_date) === dateStr) {
          events.push({
            id: `departure-${g.id}`,
            type: "departure",
            time: g.departure_time || null,
            end_time: null,
            group_id: g.id,
            group_name: g.group_name,
            title: "עזיבה",
            location: null,
            pax: g.total_pax || null,
            details: null,
            source_entity: "Group",
            source_id: g.id,
          });
        }
      }
    });

  // 2. Meals (excluding coffee corner — handled separately)
  (allMeals || [])
    .filter(m => operationalGroupIds.has(m.group_id) && m.status === "ACTIVE" && m.date === dateStr && m.meal_type !== "COFFEE_CORNER")
    .forEach(m => {
      events.push({
        id: `meal-${m.id}`,
        type: "meal",
        time: m.start_time || null,
        end_time: m.end_time || null,
        group_id: m.group_id,
        group_name: null, // resolved below
        title: MEAL_TYPE_HEB[m.meal_type] || "ארוחה",
        location: null,
        pax: m.pax || null,
        details: m.notes || null,
        status: m.status,
        source_entity: "MealReservation",
        source_id: m.id,
        _meal: m,
      });
    });

  // 3. Coffee corner requests
  (allCoffeeRequests || [])
    .filter(r => operationalGroupIds.has(r.group_id) && r.status === "ACTIVE" && r.date === dateStr)
    .forEach(r => {
      events.push({
        id: `coffee-${r.id}`,
        type: "coffee",
        time: r.start_time || null,
        end_time: r.end_time || null,
        group_id: r.group_id,
        group_name: null,
        title: "פינת קפה",
        location: r.location_name_snapshot || null,
        pax: r.pax || null,
        details: coffeeTypeLabel(r.coffee_corner_type),
        source_entity: "CoffeeCornerRequest",
        source_id: r.id,
      });
    });

  // 4. Prisa requests (no exact HH:MM — placed logically by pickup_slot)
  (allPrisaRequests || [])
    .filter(r => operationalGroupIds.has(r.group_id) && r.status === "ACTIVE" && r.date === dateStr)
    .forEach(r => {
      const slotLabel = PRISA_SLOT_LABELS[r.pickup_slot] || r.pickup_slot || "";
      const typeLabel = PRISA_TYPE_LABELS[r.type] || r.type || "";
      const isDouble = r.type === "DOUBLE" || r.type === "ONE_AND_HALF";
      const effQty = Number(r.effective_quantity) || 0;
      const baseQty = Number(r.quantity) || 0;
      const qtyDetail = isDouble && effQty && effQty !== baseQty
        ? `${typeLabel} · כמות הכנה: ${effQty}`
        : typeLabel;
      events.push({
        id: `prisa-${r.id}`,
        type: "prisa",
        time: null,
        end_time: null,
        sort_hint: PRISA_SLOT_ORDER[r.pickup_slot] ?? 99,
        group_id: r.group_id,
        group_name: null,
        title: "פריסה",
        location: null,
        pax: baseQty || null,
        details: `${slotLabel}${qtyDetail ? " · " + qtyDetail : ""}`,
        source_entity: "PrisaRequest",
        source_id: r.id,
      });
    });

  // 5. Schedule items / activities
  (allActivities || [])
    .filter(a => (a.standalone || operationalGroupIds.has(a.group_id)) && a.status === "ACTIVE" && a.date === dateStr)
    .forEach(a => {
      events.push({
        id: `activity-${a.id}`,
        type: "activity",
        time: a.start_time || null,
        end_time: a.end_time || null,
        group_id: a.group_id,
        group_name: a.standalone ? "פעילות כללית" : null,
        title: a.activity_name || "פעילות",
        location: a.activity_space_id || null,
        pax: a.pax || null,
        details: a.notes || null,
        source_entity: a.standalone ? "StandaloneActivityReservation" : "GroupScheduleItem",
        source_id: a.id,
        standalone: !!a.standalone,
        _activity: a,
      });
    });

  return events;
}

// ── Sort events: timed first (ascending), no-time last ────────────────────────
function sortEvents(events) {
  const timed = events.filter(e => e.time).sort((a, b) => a.time.localeCompare(b.time) || (a.end_time || "").localeCompare(b.end_time || ""));
  const untimed = events.filter(e => !e.time).sort((a, b) => (a.sort_hint ?? 99) - (b.sort_hint ?? 99));
  return { timed, untimed };
}

// ── Single event row ──────────────────────────────────────────────────────────
function EventRow({ event, groupMap, spaceMap }) {
  const navigate = useNavigate();
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.activity;
  const { Icon } = cfg;

  // Resolve group name
  const groupName = event.group_name || groupMap[event.group_id]?.group_name || null;

  // Resolve space name for activities
  const spaceName = event.type === "activity" && event._activity?.space_ids?.length
    ? event._activity.space_ids.map((id) => spaceMap[id]?.name).filter(Boolean).join(", ")
    : event.type === "activity" && event._activity?.activity_space_id
      ? (spaceMap[event._activity.activity_space_id]?.name || null)
      : event.location || null;

  const handleClick = () => {
    if (event.standalone) navigate(`/common-spaces?activity=${event.source_id}`);
    else if (event.group_id) navigate(`/groups/${event.group_id}`);
  };

  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border px-3 py-2.5 cursor-pointer hover:brightness-95 transition-all",
        cfg.bg, cfg.border
      )}
      onClick={handleClick}
      title={event.standalone ? "לחץ לפרטי הפעילות" : "לחץ לפרטי הקבוצה"}
    >
      {/* Time column */}
      <div className="shrink-0 w-16 text-right">
        {event.time ? (
          <span className={cn("text-sm font-mono font-bold leading-tight", cfg.time_color)} dir="ltr">
            {event.time}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
        {event.end_time && (
          <div className={cn("text-[10px] font-mono opacity-60", cfg.time_color)} dir="ltr">
            –{event.end_time}
          </div>
        )}
      </div>

      {/* Type badge + content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type badge */}
          <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 leading-none shrink-0", cfg.badge)}>
            <Icon className="w-3 h-3 shrink-0" />
            {event.standalone ? "פעילות כללית" : event.type === "meal" ? event.title : cfg.label}
          </span>

          {event.type === "activity" && <span className="text-xs font-semibold text-slate-800 truncate">{event.title}</span>}
          {groupName && !event.standalone && <span className="text-xs text-slate-600 truncate">{groupName}</span>}

          {/* Pax */}
          {event.pax > 0 && (
            <span className="text-xs text-slate-500 shrink-0">{event.pax} 👤</span>
          )}
        </div>

        {/* Second line: location, details */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {spaceName && (
            <span className="text-xs text-slate-500">📍 {spaceName}</span>
          )}
          {event.details && (
            <span className="text-xs text-slate-400">{event.details}</span>
          )}
        </div>

        {/* Activity equipment */}
        {event.type === "activity" && event._activity && (
          <ActivityEquipmentLine item={event._activity} />
        )}

        {/* Meal diet badges if available */}
        {event.type === "meal" && event._meal?.special_diets_summary && (() => {
          let d = null;
          try { d = JSON.parse(event._meal.special_diets_summary); } catch { return null; }
          if (!d) return null;
          const items = [
            d.lifeThreatening_count > 0 && `⚠ ${d.lifeThreatening_count} אלרגיות`,
            d.vegetarian_count > 0 && `${d.vegetarian_count} צמחוני`,
            d.vegan_count > 0 && `${d.vegan_count} טבעוני`,
          ].filter(Boolean);
          if (items.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1">
              {items.map((it, i) => (
                <span key={i} className="text-[10px] bg-white/80 rounded px-1.5 py-0.5 text-amber-700">{it}</span>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ChronologicalDayView({
  dateStr,
  allGroups,
  allMeals,
  allActivities,
  allCoffeeRequests,
  allPrisaRequests,
  allSpaces,
  activitiesOnly = false,
}) {
  const groupMap = useMemo(
    () => Object.fromEntries((allGroups || []).filter(isGroupOperationallyEnabled).map(g => [g.id, g])),
    [allGroups]
  );
  const spaceMap = useMemo(
    () => Object.fromEntries((allSpaces || []).map(s => [s.id, s])),
    [allSpaces]
  );

  const activeCoffeeKeys = useMemo(() => {
    const keys = new Set();
    (allCoffeeRequests || []).forEach(r => { if (r.status === "ACTIVE") keys.add(`${r.group_id}|${r.date}`); });
    return keys;
  }, [allCoffeeRequests]);

  const rawEvents = useMemo(() =>
    buildChronologicalDayEvents({ dateStr, allGroups, allMeals, allActivities, allCoffeeRequests, allPrisaRequests, activeCoffeeKeys }),
    [dateStr, allGroups, allMeals, allActivities, allCoffeeRequests, allPrisaRequests, activeCoffeeKeys]
  );

  // Resolve group names from groupMap
  const events = useMemo(() =>
    rawEvents.map(e => ({ ...e, group_name: e.group_name || groupMap[e.group_id]?.group_name || null }))
      .filter((event) => !activitiesOnly || event.type === "activity"),
    [rawEvents, groupMap, activitiesOnly]
  );

  const { timed, untimed } = useMemo(() => sortEvents(events), [events]);

  if (events.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-8">אין אירועים ביום זה</p>;
  }

  return (
    <div className="space-y-2">
      {timed.map(event => (
        <EventRow key={event.id} event={event} groupMap={groupMap} spaceMap={spaceMap} />
      ))}

      {untimed.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <div className="flex-1 border-t border-dashed border-slate-200" />
            <span className="text-[11px] text-slate-400 font-medium shrink-0">ללא שעה</span>
            <div className="flex-1 border-t border-dashed border-slate-200" />
          </div>
          {untimed.map(event => (
            <EventRow key={event.id} event={event} groupMap={groupMap} spaceMap={spaceMap} />
          ))}
        </>
      )}
    </div>
  );
}