import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import moment from "moment";
import "moment/locale/he";
import {
  X, Users, UtensilsCrossed, CalendarDays, AlertTriangle,
  ArrowDownCircle, ArrowUpCircle, Moon, ChevronDown, ChevronUp, ExternalLink, Sun, Clock, Coffee, Sandwich
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActivityEquipmentLine } from "@/components/schedule/LogisticsFields";
import ChronologicalDayView from "./ChronologicalDayView";
import ChronologicalDayPdfButton from "./ChronologicalDayPdfButton";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";
import { classifyGroupsForDate, isGroupArrivalOnDate, isGroupDepartureOnDate } from "@/lib/groupDateReaders";
import useGroupStayPeriods from "@/hooks/useGroupStayPeriods";
import { PRISA_TYPE_LABELS, PRISA_SLOT_LABELS } from "@/lib/prisaLabels";

const COFFEE_TYPE_LABELS = {
  "פינת קפה רגילה": "רגילה",
  "פינת קפה ועוגיות": "עם עוגיות",
  "פינת קפה ומאפה": "עם מאפה",
  "HOT_WATER_THERMOCAN_ONLY": "מים חמים / תרמוס",
};
const coffeeTypeLabel = (value) => COFFEE_TYPE_LABELS[value] || value || null;

moment.locale("he");

const fmt = (d) => moment(d).format("YYYY-MM-DD");

const MEAL_TYPE_HEB = {
  BREAKFAST: "ארוחת בוקר",
  LUNCH: "ארוחת צהריים",
  DINNER: "ארוחת ערב",
  COFFEE_CORNER: "פינת קפה",
  OTHER: "אחר",
};
const MEAL_ORDER = { BREAKFAST: 0, LUNCH: 1, DINNER: 2, COFFEE_CORNER: 3, OTHER: 4 };
const EXCLUDED = new Set(["CANCELLED", "COMPLETED", "ARCHIVED"]);

const isDayUse = (group) => group.group_type === "DAY_USE";

// ── Movement label — split by group_type ─────────────────────────────────────
function movementLabel(group, dateStr, periods = []) {
  if (isDayUse(group)) {
    return { label: "באי יום", color: "bg-teal-100 text-teal-700" };
  }
  // Lodging groups — period-aware for MULTI_PERIOD
  const isCheckin  = isGroupArrivalOnDate(group, dateStr, periods);
  const isCheckout = isGroupDepartureOnDate(group, dateStr, periods);
  if (isCheckin && isCheckout) return { label: "צ׳ק-אין + צ׳ק-אאוט לינה", color: "bg-purple-100 text-purple-700" };
  if (isCheckin)               return { label: "צ׳ק-אין לינה",             color: "bg-emerald-100 text-emerald-700" };
  if (isCheckout)              return { label: "צ׳ק-אאוט לינה",            color: "bg-orange-100 text-orange-700" };
  return                              { label: "שוהים",                     color: "bg-blue-100 text-blue-700" };
}

function DietBadges({ specialDietsSummary }) {
  if (!specialDietsSummary) return null;
  let d = null;
  try { d = JSON.parse(specialDietsSummary); } catch { return null; }
  if (!d) return null;
  const items = [
    d.lifeThreatening_count > 0 && { label: `⚠ ${d.lifeThreatening_count} אלרגיות מסכנות חיים`, cls: "bg-red-100 text-red-700 font-bold" },
    d.vegetarian_count > 0 && { label: `${d.vegetarian_count} צמחוני`, cls: "bg-green-100 text-green-700" },
    d.vegan_count > 0 && { label: `${d.vegan_count} טבעוני`, cls: "bg-green-100 text-green-700" },
    d.glutenFree_count > 0 && { label: `${d.glutenFree_count} ללא גלוטן`, cls: "bg-amber-100 text-amber-700" },
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((it, i) => (
        <span key={i} className={cn("text-[11px] rounded px-1.5 py-0.5 leading-none", it.cls)}>{it.label}</span>
      ))}
    </div>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────
function GroupCard({ group, dateStr, meals, activities, spaces, alerts, periods = [], defaultOpen, highlightSection, coffeeRequests = [], prisaRequests = [] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(defaultOpen);

  const mv = movementLabel(group, dateStr, periods);
  const spaceById = useMemo(() => Object.fromEntries((spaces || []).map(s => [s.id, s])), [spaces]);
  const isDay = isDayUse(group);

  const groupMeals = useMemo(() =>
    (meals || [])
      .filter(m => m.group_id === group.id && m.date === dateStr && m.status === "ACTIVE")
      .sort((a, b) => (MEAL_ORDER[a.meal_type] ?? 99) - (MEAL_ORDER[b.meal_type] ?? 99)),
    [meals, group.id, dateStr]
  );

  const groupActivities = useMemo(() =>
    (activities || [])
      .filter(a => a.group_id === group.id && a.date === dateStr && a.status === "ACTIVE")
      .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "")),
    [activities, group.id, dateStr]
  );

  const groupCoffee = useMemo(() =>
    (coffeeRequests || [])
      .filter(r => r.group_id === group.id && r.date === dateStr && r.status === "ACTIVE")
      .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "")),
    [coffeeRequests, group.id, dateStr]
  );

  const groupPrisa = useMemo(() =>
    (prisaRequests || [])
      .filter(r => r.group_id === group.id && r.date === dateStr && r.status === "ACTIVE"),
    [prisaRequests, group.id, dateStr]
  );

  const groupAlerts = useMemo(() =>
    (alerts || []).filter(a => a.group_id === group.id && a.status === "OPEN"),
    [alerts, group.id]
  );

  const isCheckin  = isGroupArrivalOnDate(group, dateStr, periods);
  const isCheckout = isGroupDepartureOnDate(group, dateStr, periods);

  // Border color by group type
  const borderCls = isDay
    ? "border-teal-200"
    : isCheckin && !isCheckout ? "border-emerald-200"
    : isCheckout && !isCheckin ? "border-orange-200"
    : groupAlerts.length > 0  ? "border-red-200"
    : "border-slate-200";

  // Dot color
  const dotCls = isDay
    ? "bg-teal-500"
    : isCheckin && !isCheckout ? "bg-emerald-500"
    : isCheckout && !isCheckin ? "bg-orange-500"
    : "bg-blue-400";

  // Movement section inside card
  const renderMovementSection = () => {
    if (isDay) {
      // Day-use: show arrival/departure/range
      const hasArrival   = group.arrival_time;
      const hasDeparture = group.departure_time;
      if (hasArrival && hasDeparture) {
        return (
          <div className="flex items-center gap-2 text-teal-700 text-xs">
            <Sun className="w-3.5 h-3.5 shrink-0" />
            <span>באי יום · {group.arrival_time}–{group.departure_time}</span>
          </div>
        );
      }
      return (
        <div className="space-y-1">
          {hasArrival && (
            <div className="flex items-center gap-2 text-teal-700 text-xs">
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span>באי יום · הגעה {group.arrival_time}</span>
            </div>
          )}
          {hasDeparture && (
            <div className="flex items-center gap-2 text-teal-600 text-xs">
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span>באי יום · סיום {group.departure_time}</span>
            </div>
          )}
          {!hasArrival && !hasDeparture && (
            <div className="flex items-center gap-2 text-teal-600 text-xs">
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span>באי יום</span>
            </div>
          )}
        </div>
      );
    }
    // Lodging
    return (
      <div className="space-y-1">
        {isCheckin && (
          <div className="flex items-center gap-2 text-emerald-700 text-xs">
            <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
            <span>לינה · צ׳ק-אין{group.arrival_time ? ` ${group.arrival_time}` : ""}</span>
          </div>
        )}
        {isCheckout && (
          <div className="flex items-center gap-2 text-orange-600 text-xs">
            <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
            <span>לינה · צ׳ק-אאוט{group.departure_time ? ` ${group.departure_time}` : ""}</span>
          </div>
        )}
        {!isCheckin && !isCheckout && (
          <div className="flex items-center gap-2 text-blue-500 text-xs">
            <Moon className="w-3.5 h-3.5 shrink-0" />
            <span>לינה · שוהה</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("rounded-xl border overflow-hidden", borderCls)}>
      <button
        type="button"
        className={cn("w-full flex items-center gap-3 px-4 py-3 text-right transition-colors", open ? "bg-slate-50" : "bg-white hover:bg-slate-50")}
        onClick={() => setOpen(o => !o)}
      >
        <span className={cn("w-2 h-2 rounded-full shrink-0", dotCls)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800 truncate">{group.group_name}</p>
            <span className={cn("text-xs rounded px-1.5 py-0.5 leading-none font-medium", mv.color)}>{mv.label}</span>
            {groupAlerts.length > 0 && (
              <span className="text-xs rounded px-1.5 py-0.5 leading-none font-medium bg-red-100 text-red-700">⚠ {groupAlerts.length} התראות</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {group.total_pax ? `${group.total_pax} אורחים` : ""}
            {group.arrival_date && group.departure_date && <span className="mr-2">{group.arrival_date} – {group.departure_date}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-slate-400">
          {groupMeals.length > 0 && <span className="text-xs flex items-center gap-0.5"><UtensilsCrossed className="w-3 h-3" />{groupMeals.length}</span>}
          {groupCoffee.length > 0 && <span className="text-xs flex items-center gap-0.5"><Coffee className="w-3 h-3" />{groupCoffee.length}</span>}
          {groupPrisa.length > 0 && <span className="text-xs flex items-center gap-0.5"><Sandwich className="w-3 h-3" />{groupPrisa.length}</span>}
          {groupActivities.length > 0 && <span className="text-xs flex items-center gap-0.5"><CalendarDays className="w-3 h-3" />{groupActivities.length}</span>}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {/* תנועה */}
          {(!highlightSection || highlightSection === "movement") && (
            <div className="px-4 py-3">
              {renderMovementSection()}
            </div>
          )}

          {/* ארוחות */}
          {groupMeals.length > 0 && (!highlightSection || highlightSection === "meals") && (
            <div className="px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-2">מטבח</p>
              <div className="space-y-2">
                {groupMeals.map(m => (
                  <div key={m.id} className="bg-amber-50 rounded-lg px-3 py-2 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-amber-800">{MEAL_TYPE_HEB[m.meal_type] || m.meal_type}</span>
                      {m.pax > 0 && <span className="text-xs text-slate-500">{m.pax} מנות</span>}
                    </div>
                    {m.start_time && <p className="text-xs text-slate-500" dir="ltr">{m.start_time}{m.end_time ? ` – ${m.end_time}` : ""}</p>}
                    {m.sandwich_option && <p className="text-xs text-blue-600">🥪 עם כריך</p>}
                    <DietBadges specialDietsSummary={m.special_diets_summary} />
                    {m.notes && <p className="text-xs text-slate-400">{m.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* פינות קפה */}
          {groupCoffee.length > 0 && (!highlightSection || highlightSection === "coffee") && (
            <div className="px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-yellow-600 mb-2">☕ פינות קפה</p>
              <div className="space-y-2">
                {groupCoffee.map(c => (
                  <div key={c.id} className="bg-yellow-50 rounded-lg px-3 py-2 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.start_time && (
                        <span className="text-xs font-mono bg-white border border-yellow-200 rounded px-1.5 py-0.5 text-yellow-700 shrink-0" dir="ltr">
                          {c.start_time}{c.end_time ? `–${c.end_time}` : ""}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-slate-800">פינת קפה</span>
                      {c.pax > 0 && <span className="text-xs text-slate-500">{c.pax} איש</span>}
                    </div>
                    {c.coffee_corner_type && <p className="text-xs text-slate-600">{coffeeTypeLabel(c.coffee_corner_type)}</p>}
                    {c.location_name_snapshot && <p className="text-xs text-slate-400">📍 {c.location_name_snapshot}</p>}
                    {c.notes && <p className="text-xs text-slate-400">{c.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* פריסות */}
          {groupPrisa.length > 0 && (!highlightSection || highlightSection === "prisa") && (
            <div className="px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-orange-600 mb-2">🥪 פריסות</p>
              <div className="space-y-2">
                {groupPrisa.map(p => {
                  const typeLabel = PRISA_TYPE_LABELS[p.type] || p.type || "";
                  const slotLabel = PRISA_SLOT_LABELS[p.pickup_slot] || p.pickup_slot || "";
                  const isDouble = p.type === "DOUBLE" || p.type === "ONE_AND_HALF";
                  const effQty = Number(p.effective_quantity) || 0;
                  const baseQty = Number(p.quantity) || 0;
                  return (
                    <div key={p.id} className="bg-orange-50 rounded-lg px-3 py-2 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-800">פריסה</span>
                        <span className="text-xs text-slate-600">{slotLabel}</span>
                        {baseQty > 0 && <span className="text-xs text-slate-500">{baseQty}</span>}
                        {typeLabel && <span className="text-xs text-slate-600">{typeLabel}</span>}
                      </div>
                      {isDouble && effQty && effQty !== baseQty && (
                        <p className="text-xs text-slate-500">כמות הכנה: {effQty}</p>
                      )}
                      {p.notes && <p className="text-xs text-slate-400">{p.notes}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* פעילויות בלו״ז */}
          {groupActivities.length > 0 && (!highlightSection || highlightSection === "activities") && (
            <div className="px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-purple-600 mb-2">פעילויות בלו״ז</p>
              <div className="space-y-1.5">
                {groupActivities.map(a => {
                  const space = spaceById[a.activity_space_id];
                  return (
                    <div key={a.id} className="bg-purple-50 rounded-lg px-3 py-2 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {a.start_time && (
                          <span className="text-xs font-mono bg-white border border-purple-200 rounded px-1.5 py-0.5 text-purple-700 shrink-0" dir="ltr">
                            {a.start_time}{a.end_time ? `–${a.end_time}` : ""}
                          </span>
                        )}
                        <span className="text-xs font-semibold text-slate-800 truncate">{a.activity_name}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                         {space && <span className="text-xs text-purple-500">📍 {space.name || space.code}</span>}
                         {a.pax > 0 && <span className="text-xs text-slate-400">{a.pax} 👤</span>}
                         {a.notes && <span className="text-xs text-slate-400">{a.notes}</span>}
                       </div>
                       <ActivityEquipmentLine item={a} />
                      </div>
                      );
                      })}
                      </div>
                      </div>
                      )}

                      {/* התראות */}
          {groupAlerts.length > 0 && (!highlightSection || highlightSection === "alerts") && (
            <div className="px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-red-500 mb-2">התראות</p>
              <div className="space-y-1.5">
                {groupAlerts.map(alert => (
                  <div key={alert.id} className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    alert.severity === "CRITICAL" ? "bg-red-50 border-red-200 text-red-800" :
                    alert.severity === "WARNING"  ? "bg-amber-50 border-amber-200 text-amber-800" :
                                                   "bg-blue-50 border-blue-200 text-blue-800"
                  )}>
                    <p className="font-semibold">{alert.title}</p>
                    {alert.message && <p className="mt-0.5 text-xs opacity-80">{alert.message}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-2.5 bg-slate-50 flex justify-end">
            <button type="button" onClick={() => navigate(`/groups/${group.id}`)} className="text-xs text-primary hover:underline flex items-center gap-1">
              פרטי קבוצה <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter pill ───────────────────────────────────────────────────────────────
const FILTER_COLORS = {
  all:        { inactive: "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100",        active: "bg-slate-700 border-slate-700 text-white shadow-sm" },
  checkins:   { inactive: "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100", active: "bg-emerald-600 border-emerald-600 text-white shadow-sm" },
  checkouts:  { inactive: "bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100",    active: "bg-orange-500 border-orange-500 text-white shadow-sm" },
  dayuse:     { inactive: "bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100",            active: "bg-teal-600 border-teal-600 text-white shadow-sm" },
  meals:      { inactive: "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100",         active: "bg-amber-500 border-amber-500 text-white shadow-sm" },
  activities: { inactive: "bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100",    active: "bg-purple-600 border-purple-600 text-white shadow-sm" },
  alerts:     { inactive: "bg-red-50 border-red-300 text-red-700 hover:bg-red-100",                active: "bg-red-600 border-red-600 text-white shadow-sm" },
  coffee:     { inactive: "bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100",     active: "bg-yellow-500 border-yellow-500 text-white shadow-sm" },
  prisa:      { inactive: "bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100",     active: "bg-orange-500 border-orange-500 text-white shadow-sm" },
  chrono:     { inactive: "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100",        active: "bg-slate-800 border-slate-800 text-white shadow-sm" },
};

function FilterPill({ label, count, icon: Icon, active, onClick, filterKey }) {
  if (count === 0) return null;
  const colors = FILTER_COLORS[filterKey] || FILTER_COLORS.all;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-all",
        active ? colors.active : colors.inactive
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      {label}
      <span className={cn(
        "rounded-full px-1.5 py-0.5 text-[11px] leading-none font-bold",
        active ? "bg-white/25 text-white" : "bg-white/80 text-slate-600"
      )}>
        {count}
      </span>
    </button>
  );
}

// ── Flat grouped view (meals / activities / alerts / dayuse) ──────────────────
function GroupedFlatSection({ filter, groups, dateStr, meals, activities, spaces, alerts, periodsByGroupId = {} }) {
  const spaceById = useMemo(() => Object.fromEntries((spaces || []).map(s => [s.id, s])), [spaces]);

  const groupsWithContent = useMemo(() => {
    return groups.map(group => {
      const groupMeals = filter === "meals"
        ? (meals || []).filter(m => m.group_id === group.id && m.date === dateStr && m.status === "ACTIVE")
            .sort((a, b) => (MEAL_ORDER[a.meal_type] ?? 99) - (MEAL_ORDER[b.meal_type] ?? 99))
        : [];
      const groupActivities = filter === "activities"
        ? (activities || []).filter(a => a.group_id === group.id && a.date === dateStr && a.status === "ACTIVE")
            .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""))
        : [];
      const groupAlerts = filter === "alerts"
        ? (alerts || []).filter(a => a.group_id === group.id && a.status === "OPEN")
        : [];
      return { group, groupMeals, groupActivities, groupAlerts };
    }).filter(({ groupMeals, groupActivities, groupAlerts, group }) =>
      groupMeals.length > 0 || groupActivities.length > 0 || groupAlerts.length > 0 || filter === "dayuse"
    );
  }, [filter, groups, meals, activities, alerts, dateStr]);

  if (groupsWithContent.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-8">אין נתונים להצגה</p>;
  }

  return (
    <div className="space-y-4">
      {groupsWithContent.map(({ group, groupMeals, groupActivities, groupAlerts }) => {
        const isDay = isDayUse(group);
        const periods = periodsByGroupId[group.id] || [];
        const dotCls = isDay ? "bg-teal-500"
          : isGroupArrivalOnDate(group, dateStr, periods) ? "bg-emerald-500"
          : isGroupDepartureOnDate(group, dateStr, periods) ? "bg-orange-500"
          : "bg-blue-400";

        return (
          <div key={group.id} className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full shrink-0", dotCls)} />
              <p className="text-sm font-semibold text-slate-800">{group.group_name}</p>
              {isDay && <span className="text-xs bg-teal-100 text-teal-700 rounded px-1.5 py-0.5 leading-none font-medium">באי יום</span>}
              {group.total_pax > 0 && <span className="text-xs text-slate-400 mr-auto">{group.total_pax} אורחים</span>}
            </div>

            <div className="px-4 py-3 space-y-2">
              {/* meals */}
              {groupMeals.map(m => (
                <div key={m.id} className="bg-amber-50 rounded-lg px-3 py-2 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-800">{MEAL_TYPE_HEB[m.meal_type] || m.meal_type}</span>
                    {m.pax > 0 && <span className="text-xs text-slate-500">{m.pax} מנות</span>}
                  </div>
                  {m.start_time && <p className="text-xs text-slate-500" dir="ltr">{m.start_time}{m.end_time ? ` – ${m.end_time}` : ""}</p>}
                  {m.sandwich_option && <p className="text-xs text-blue-600">🥪 עם כריך</p>}
                  <DietBadges specialDietsSummary={m.special_diets_summary} />
                  {m.notes && <p className="text-xs text-slate-400">{m.notes}</p>}
                </div>
              ))}

              {/* פעילויות בלו״ז */}
              {groupActivities.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-purple-600 pt-1">פעילויות בלו״ז</p>
                  {groupActivities.map(a => {
                    const space = spaceById[a.activity_space_id];
                    return (
                      <div key={a.id} className="bg-purple-50 rounded-lg px-3 py-2 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {a.start_time && (
                            <span className="text-xs font-mono bg-white border border-purple-200 rounded px-1.5 py-0.5 text-purple-700 shrink-0" dir="ltr">
                              {a.start_time}{a.end_time ? `–${a.end_time}` : ""}
                            </span>
                          )}
                          <span className="text-xs font-semibold text-slate-800 truncate">{a.activity_name}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                           {space && <span className="text-xs text-purple-500">📍 {space.name || space.code}</span>}
                           {a.pax > 0 && <span className="text-xs text-slate-400">{a.pax} 👤</span>}
                           {a.notes && <span className="text-xs text-slate-400">{a.notes}</span>}
                         </div>
                         <ActivityEquipmentLine item={a} />
                        </div>
                        );
                        })}
                        </>
                        )}

              {/* alerts */}
              {groupAlerts.map(alert => (
                <div key={alert.id} className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  alert.severity === "CRITICAL" ? "bg-red-50 border-red-200 text-red-800" :
                  alert.severity === "WARNING"  ? "bg-amber-50 border-amber-200 text-amber-800" :
                                                 "bg-blue-50 border-blue-200 text-blue-800"
                )}>
                  <p className="font-semibold">{alert.title}</p>
                  {alert.message && <p className="mt-0.5 opacity-80">{alert.message}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Filter titles ─────────────────────────────────────────────────────────────
const FILTER_TITLES = {
  all:        "כל הקבוצות",
  checkins:   "צ׳ק-אין לינה היום",
  checkouts:  "צ׳ק-אאוט לינה היום",
  dayuse:     "באי יום — היום",
  meals:      "ארוחות היום",
  activities: "פעילויות בלו״ז היום",
  alerts:     "התראות היום",
  coffee:     "פינות קפה היום",
  prisa:      "פריסות היום",
  chrono:     "סדר יום כרונולוגי",
};

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function OperationalDaySummary({
  date, isOpen, onClose,
  allGroups, allMeals, allActivities, allSpaces, allAlerts,
  allCoffeeRequests = [],
  allPrisaRequests = [],
}) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState("all");

  const dateStr   = date ? fmt(date) : "";
  const dateLabel = date ? moment(date).format("dddd, D בMMMM YYYY") : "";
  const operationalGroupIds = useMemo(() => new Set((allGroups || []).filter(isGroupOperationallyEnabled).map(g => g.id)), [allGroups]);
  const { periodsByGroupId } = useGroupStayPeriods(allGroups || []);

  const { lodgingCheckins, lodgingCheckouts, dayUseGroups, staying, allGroupsOnDay } = useMemo(() => {
    if (!dateStr) return { lodgingCheckins: [], lodgingCheckouts: [], dayUseGroups: [], staying: [], allGroupsOnDay: [] };
    const groups = (allGroups || []).filter(g => isGroupOperationallyEnabled(g) && !EXCLUDED.has(g.status) && g.arrival_date && g.departure_date);

    // Lodging: period-aware classification for MULTI_PERIOD groups
    const lodgingGroups = groups.filter(g => !isDayUse(g));
    const { arrivals: lodgingCheckins, departures: lodgingCheckouts, staying: lodgingStaying } = classifyGroupsForDate(lodgingGroups, dateStr, periodsByGroupId);
    const staying = lodgingStaying;
    // Day-use groups: DAY_USE groups active today
    const dayUseGroups = groups.filter(g => isDayUse(g) && fmt(g.arrival_date) === dateStr);

    // All groups on site today (deduped)
    const seen = new Set();
    const allGroupsOnDay = [...lodgingCheckins, ...lodgingCheckouts.filter(g => !lodgingCheckins.includes(g)), ...staying, ...dayUseGroups]
      .filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; });

    return { lodgingCheckins, lodgingCheckouts, dayUseGroups, staying, allGroupsOnDay };
  }, [allGroups, dateStr, periodsByGroupId]);

  // Build a set of group+date keys that have an active CoffeeCornerRequest
  const activeCoffeeKeys = useMemo(() => {
    const keys = new Set();
    (allCoffeeRequests || []).forEach(r => { if (r.status === "ACTIVE") keys.add(`${r.group_id}|${r.date}`); });
    return keys;
  }, [allCoffeeRequests]);

  const dayMeals = useMemo(() =>
    (allMeals || []).filter(m => {
      if (!operationalGroupIds.has(m.group_id) || m.status !== "ACTIVE" || m.date !== dateStr) return false;
      // Filter out ghost COFFEE_CORNER MealReservations with no matching active CoffeeCornerRequest
      if (m.meal_type === "COFFEE_CORNER" && !activeCoffeeKeys.has(`${m.group_id}|${m.date}`)) return false;
      return true;
    }),
    [allMeals, dateStr, activeCoffeeKeys, operationalGroupIds]
  );

  const dayCoffeeRequests = useMemo(() =>
    (allCoffeeRequests || []).filter(request => operationalGroupIds.has(request.group_id) && request.status === "ACTIVE" && request.date === dateStr),
    [allCoffeeRequests, dateStr, operationalGroupIds]
  );

  const dayPrisaRequests = useMemo(() =>
    (allPrisaRequests || []).filter(request => operationalGroupIds.has(request.group_id) && request.status === "ACTIVE" && request.date === dateStr),
    [allPrisaRequests, dateStr, operationalGroupIds]
  );

  const dayActivities = useMemo(() =>
    (allActivities || []).filter(a => (a.standalone || operationalGroupIds.has(a.group_id)) && a.status === "ACTIVE" && a.date === dateStr)
      .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "") || (a.end_time || "").localeCompare(b.end_time || "")),
    [allActivities, dateStr, operationalGroupIds]
  );

  const groupIdsOnDay = useMemo(() => new Set(allGroupsOnDay.map(g => g.id)), [allGroupsOnDay]);

  const dayAlerts = useMemo(() =>
    (allAlerts || []).filter(a => a.status === "OPEN" && groupIdsOnDay.has(a.group_id)),
    [allAlerts, groupIdsOnDay]
  );

  const totalPaxOnSite = useMemo(() =>
    [...lodgingCheckins, ...staying].reduce((s, g) => s + (Number(g.total_pax) || 0), 0),
    [lodgingCheckins, staying]
  );

  const handleFilter = (f) => setActiveFilter(prev => prev === f ? "all" : f);

  // Which groups to show in the list, depending on active filter
  const visibleGroups = useMemo(() => {
    if (activeFilter === "checkins")   return [...lodgingCheckins].sort((a, b) => (a.arrival_time || "99:99").localeCompare(b.arrival_time || "99:99"));
    if (activeFilter === "checkouts")  return [...lodgingCheckouts].sort((a, b) => (a.departure_time || "99:99").localeCompare(b.departure_time || "99:99"));
    if (activeFilter === "dayuse")     return [...dayUseGroups].sort((a, b) => (a.arrival_time || "99:99").localeCompare(b.arrival_time || "99:99"));
    if (activeFilter === "meals")      return allGroupsOnDay.filter(g => dayMeals.some(m => m.group_id === g.id));
    if (activeFilter === "activities") return allGroupsOnDay.filter(g => dayActivities.some(a => a.group_id === g.id));
    if (activeFilter === "alerts")     return allGroupsOnDay.filter(g => dayAlerts.some(a => a.group_id === g.id));
    if (activeFilter === "coffee")    return allGroupsOnDay.filter(g => dayCoffeeRequests.some(c => c.group_id === g.id));
    if (activeFilter === "prisa")     return allGroupsOnDay.filter(g => dayPrisaRequests.some(p => p.group_id === g.id));
    return allGroupsOnDay;
  },     [activeFilter, lodgingCheckins, lodgingCheckouts, dayUseGroups, allGroupsOnDay, dayMeals, dayActivities, dayAlerts, dayCoffeeRequests, dayPrisaRequests]);

  // Group cards for all/checkins/checkouts/dayuse; flat sections for others
  const useGroupCards = ["all", "checkins", "checkouts", "dayuse", "coffee", "prisa"].includes(activeFilter) && activeFilter !== "chrono";

  if (!isOpen || !date) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">סיכום תפעולי</h2>
            <p className="text-sm text-muted-foreground">{dateLabel}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Filter pills ── */}
        <div className="shrink-0 px-5 py-3 border-b border-slate-100 bg-white space-y-2">
          {allGroupsOnDay.length === 0 && dayActivities.length === 0 ? (
            <p className="text-sm text-slate-400">אין נתונים ביום זה</p>
          ) : (
            <>
              <div className="space-y-0.5">
                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{allGroupsOnDay.length} קבוצות באתר</span>
                  {totalPaxOnSite > 0 && <span className="mr-2">· {totalPaxOnSite} אורחים</span>}
                </p>
                {(lodgingCheckins.length + lodgingCheckouts.length + staying.length > 0 || dayUseGroups.length > 0) && (
                  <p className="text-[11px] text-slate-400">
                    {lodgingCheckins.length + lodgingCheckouts.length + staying.length > 0 && (
                      <span>לינה: {[...new Set([...lodgingCheckins, ...lodgingCheckouts, ...staying].map(g => g.id))].length}</span>
                    )}
                    {lodgingCheckins.length + lodgingCheckouts.length + staying.length > 0 && dayUseGroups.length > 0 && <span> · </span>}
                    {dayUseGroups.length > 0 && <span>באי יום: {dayUseGroups.length}</span>}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterPill label="כל הקבוצות" count={allGroupsOnDay.length} icon={Users}
                  active={activeFilter === "all"} onClick={() => handleFilter("all")} filterKey="all" />
                <FilterPill label="צ׳ק-אין לינה" count={lodgingCheckins.length} icon={ArrowDownCircle}
                  active={activeFilter === "checkins"} onClick={() => handleFilter("checkins")} filterKey="checkins" />
                <FilterPill label="צ׳ק-אאוט לינה" count={lodgingCheckouts.length} icon={ArrowUpCircle}
                  active={activeFilter === "checkouts"} onClick={() => handleFilter("checkouts")} filterKey="checkouts" />
                <FilterPill label="באי יום" count={dayUseGroups.length} icon={Sun}
                  active={activeFilter === "dayuse"} onClick={() => handleFilter("dayuse")} filterKey="dayuse" />
                <FilterPill label="ארוחות" count={dayMeals.length} icon={UtensilsCrossed}
                  active={activeFilter === "meals"} onClick={() => handleFilter("meals")} filterKey="meals" />
                <FilterPill label='פעילויות בלו"ז' count={dayActivities.length} icon={CalendarDays}
                  active={activeFilter === "activities"} onClick={() => handleFilter("activities")} filterKey="activities" />
                <FilterPill label="התראות" count={dayAlerts.length} icon={AlertTriangle}
                  active={activeFilter === "alerts"} onClick={() => handleFilter("alerts")} filterKey="alerts" />
                <FilterPill label="פינות קפה" count={dayCoffeeRequests.length} icon={Coffee}
                  active={activeFilter === "coffee"} onClick={() => handleFilter("coffee")} filterKey="coffee" />
                <FilterPill label="פריסות" count={dayPrisaRequests.length} icon={Sandwich}
                  active={activeFilter === "prisa"} onClick={() => handleFilter("prisa")} filterKey="prisa" />
                <FilterPill label="סדר יום כרונולוגי" count={dayMeals.length + dayCoffeeRequests.length + dayPrisaRequests.length + dayActivities.length + lodgingCheckins.length + lodgingCheckouts.length + dayUseGroups.length} icon={Clock}
                  active={activeFilter === "chrono"} onClick={() => handleFilter("chrono")} filterKey="chrono" />
              </div>
            </>
          )}
        </div>

        {/* ── Section title ── */}
        {activeFilter !== "all" && (
          <div className="shrink-0 px-5 py-2 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{FILTER_TITLES[activeFilter]}</p>
          </div>
        )}

        {/* ── Scrollable content ── */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {visibleGroups.length === 0 && activeFilter !== "chrono" && activeFilter !== "activities" && !(activeFilter === "all" && dayActivities.some((item) => item.standalone)) && (
            <p className="text-sm text-slate-400 text-center py-8">אין נתונים להצגה</p>
          )}

          {useGroupCards && visibleGroups.map(group => {
            const periods = periodsByGroupId[group.id] || [];
            const isCheckin  = isGroupArrivalOnDate(group, dateStr, periods);
            const isCheckout = isGroupDepartureOnDate(group, dateStr, periods);
            const hasAlerts  = (allAlerts || []).some(a => a.group_id === group.id && a.status === "OPEN");
            const defaultOpen = isCheckin || isCheckout || isDayUse(group) || hasAlerts || activeFilter !== "all";
            return <GroupCard key={group.id} group={group} dateStr={dateStr} meals={allMeals} activities={allActivities} spaces={allSpaces} alerts={allAlerts} periods={periods} defaultOpen={defaultOpen} coffeeRequests={allCoffeeRequests} prisaRequests={allPrisaRequests} />;
          })}

          {activeFilter === "all" && dayActivities.filter((item) => item.standalone).map((item) => (
            <button key={`standalone-${item.id}`} type="button" onClick={() => navigate(`/common-spaces?activity=${item.id}`)} className="w-full text-right rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
              <div className="flex items-center gap-2"><span className="text-xs bg-purple-600 text-white rounded-full px-2 py-0.5">פעילות כללית</span><span className="font-semibold text-sm">{item.activity_name}</span></div>
              <div className="text-xs text-slate-500 mt-1">{item.start_time}–{item.end_time}{item.pax ? ` · ${item.pax} משתתפים` : ""}</div>
            </button>
          ))}

          {activeFilter === "activities" && (
            <ChronologicalDayView dateStr={dateStr} allGroups={allGroups} allMeals={[]} allActivities={dayActivities} allCoffeeRequests={[]} allSpaces={allSpaces} activitiesOnly />
          )}

          {!useGroupCards && activeFilter !== "chrono" && activeFilter !== "activities" && (
            <GroupedFlatSection
              filter={activeFilter}
              groups={visibleGroups}
              dateStr={dateStr}
              meals={allMeals}
              activities={allActivities}
              spaces={allSpaces}
              alerts={allAlerts}
              periodsByGroupId={periodsByGroupId}
            />
          )}

          {activeFilter === "chrono" && (
            <>
              <div className="flex justify-end mb-1">
                <ChronologicalDayPdfButton
                  dateStr={dateStr}
                  allGroups={allGroups}
                  allMeals={allMeals}
                  allActivities={allActivities}
                  allCoffeeRequests={allCoffeeRequests}
                  allPrisaRequests={allPrisaRequests}
                  allSpaces={allSpaces}
                />
              </div>
              <ChronologicalDayView
                dateStr={dateStr}
                allGroups={allGroups}
                allMeals={allMeals}
                allActivities={allActivities}
                allCoffeeRequests={allCoffeeRequests}
                allPrisaRequests={allPrisaRequests}
                allSpaces={allSpaces}
              />
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl shrink-0 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>סגור</Button>
        </div>
      </div>
    </div>
  );
}