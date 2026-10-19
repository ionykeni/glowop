import { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { CheckCircle2, Clock, Calendar, Users, ChevronLeft, BedDouble, CalendarDays } from "lucide-react";
import GroupFilters from "@/components/groups/GroupFilters";
import DayGroupHeader, { groupByDay } from "@/components/groups/DayGroupHeader";

// ── helpers ──────────────────────────────────────────────────────────────────

function StatusPill({ done, labelDone, labelPending }) {
  return done ? (
    <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
      <CheckCircle2 className="w-3 h-3" /> {labelDone}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
      <Clock className="w-3 h-3" /> {labelPending}
    </span>
  );
}

function formatDate(d) {
  if (!d) return "—";
  try { return format(parseISO(d), "dd/MM/yy"); } catch { return d; }
}

function nightsCount(arrival, departure) {
  if (!arrival || !departure) return null;
  const a = new Date(arrival), b = new Date(departure);
  const n = Math.round((b - a) / 86400000);
  return n > 0 ? n : null;
}

// ── main ─────────────────────────────────────────────────────────────────────

export default function ApprovedGroups() {
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

  // ── filter state ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dateStart, setDateStart] = useState(null);
  const [dateEnd, setDateEnd] = useState(null);

  const filterState = { searchQuery, monthFilter, typeFilter, statusFilter, dateStart, dateEnd };
  const hasFilters = searchQuery || monthFilter !== "ALL" || typeFilter !== "ALL" || statusFilter !== "ALL" || dateStart || dateEnd;

  const clearAll = () => {
    setSearchQuery("");
    setMonthFilter("ALL");
    setTypeFilter("ALL");
    setStatusFilter("ALL");
    setDateStart(null);
    setDateEnd(null);
  };

  // ── data ───────────────────────────────────────────────────────
  const { data, isLoading: loading, error, refetch } = useQuery({
    queryKey: ["groups", "approved", localToday, filterState],
    queryFn: async () => {
      const response = await base44.functions.invoke("getApprovedGroups", filterState);
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
  });
  const groups = data?.groups || [];
  const activeProfiles = data?.profiles || [];
  const today = data?.today || localToday;

  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["allScheduleItems"],
    queryFn: () => base44.entities.GroupScheduleItem.filter({ status: "ACTIVE" }),
  });

  const { data: mealItems = [] } = useQuery({
    queryKey: ["allMealItems"],
    queryFn: () => base44.entities.MealReservation.filter({ status: "ACTIVE" }),
  });

  // ── maps ───────────────────────────────────────────────────────
  const groupById = Object.fromEntries(groups.map(g => [g.id, g]));
  const scheduleByProfile = {};
  const mealsByProfile = {};
  scheduleItems.forEach(s => {
    if (!scheduleByProfile[s.operational_group_profile_id]) scheduleByProfile[s.operational_group_profile_id] = [];
    scheduleByProfile[s.operational_group_profile_id].push(s);
  });
  mealItems.forEach(m => {
    if (!mealsByProfile[m.operational_group_profile_id]) mealsByProfile[m.operational_group_profile_id] = [];
    mealsByProfile[m.operational_group_profile_id].push(m);
  });

  // Bucket: upcoming vs past
  const upcoming = activeProfiles.filter(p => {
    const g = groupById[p.group_id];
    return !g?.departure_date || g.departure_date >= today;
  });
  const past = activeProfiles.filter(p => {
    const g = groupById[p.group_id];
    return g?.departure_date && g.departure_date < today;
  });

  // ── render row ─────────────────────────────────────────────────
  function renderRow(profile) {
    const group = groupById[profile.group_id];
    if (!group) return null;
    const nights = nightsCount(group.arrival_date, group.departure_date);
    const schedules = scheduleByProfile[profile.id] || [];
    const meals = mealsByProfile[profile.id] || [];
    const hasSchedule = schedules.length > 0;
    const hasMeals = meals.length > 0;
    const isActive = group.arrival_date <= today && (!group.departure_date || group.departure_date >= today);

    return (
      <Link
        key={profile.id}
        to={`/groups/${group.id}`}
        className="block bg-card border border-border rounded-xl px-4 py-3 hover:border-primary/40 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Name + type + active badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground">{group.group_name}</span>
              {isActive && (
                <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 font-semibold">
                  פעיל עכשיו
                </span>
              )}
              <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 border ${group.group_type === "DAY_USE" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                {group.group_type === "LODGING" ? "לינה" : "באי יום"}
              </span>
            </div>

            {/* Dates + pax */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(group.arrival_date)}
                {group.departure_date && ` — ${formatDate(group.departure_date)}`}
                {nights && ` · ${nights} לילות`}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {profile.total_pax ?? group.total_pax ?? "—"} אנשים
              </span>
            </div>

            {/* Status pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill done={profile.sleeping_requirements_completed} labelDone="דרישות לינה ✓" labelPending="ממתין לדרישות לינה" />
              <StatusPill done={hasSchedule} labelDone={`לוח זמנים (${schedules.length})`} labelPending="אין פעילויות" />
              <StatusPill done={hasMeals} labelDone={`ארוחות (${meals.length})`} labelPending="אין ארוחות" />
            </div>
          </div>

          <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
        </div>
      </Link>
    );
  }

  // ── day-grouped list ────────────────────────────────────────────
  function DayGroupedList({ items, emptyText }) {
    const dayGroups = groupByDay(items.map(p => groupById[p.group_id]).filter(Boolean));

    if (dayGroups.length === 0) {
      return (
        <div className="text-center py-16 text-muted-foreground text-sm border-2 border-dashed border-slate-200 rounded-xl">
          {emptyText}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {dayGroups.map(({ date, items: dayGroupsList }) => {
          // Map back to profiles
          const dayProfiles = items.filter(p => dayGroupsList.some(g => g.id === p.group_id));
          return (
            <div key={date}>
              <DayGroupHeader dateStr={date} />
              <div className="space-y-2 mt-1">
                {dayProfiles.map(renderRow)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function emptyText() {
    if (hasFilters) {
      if (monthFilter !== "ALL") return "לא נמצאו קבוצות בחודש שנבחר";
      if (searchQuery) return "לא נמצאו קבוצות התואמות לחיפוש";
      return "לא נמצאו קבוצות";
    }
    return "אין קבוצות מאושרות";
  }

  // ── render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 space-y-3" dir="rtl" role="alert">
      <p className="text-destructive">טעינת הקבוצות נכשלה</p>
      <button className="text-primary underline" onClick={() => refetch()}>נסה שוב</button>
    </div>;
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              קבוצות מאושרות
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              קבוצות עם פרופיל תפעולי מאושר — מקור אמת לתכנון שוטף
            </p>
          </div>
          <div className="text-left text-xs text-muted-foreground">
            <span className="bg-muted border border-border rounded-full px-3 py-1 font-medium">
              {activeProfiles.length} קבוצות
            </span>
          </div>
        </div>

        {/* Filters */}
        <GroupFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          monthFilter={monthFilter}
          onMonthChange={setMonthFilter}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          dateStart={dateStart}
          onDateStartChange={setDateStart}
          dateEnd={dateEnd}
          onDateEndChange={setDateEnd}
          onClearAll={clearAll}
          showStatus={false}
        />

        {/* Stats strip */}
        {upcoming.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "מגיעים היום", value: upcoming.filter(p => groupById[p.group_id]?.arrival_date === today).length, icon: CalendarDays, color: "text-blue-600" },
              { label: "פעילים עכשיו", value: upcoming.filter(p => { const g = groupById[p.group_id]; return g?.arrival_date <= today && g?.departure_date >= today; }).length, icon: Users, color: "text-emerald-600" },
              { label: "עוזבים היום", value: upcoming.filter(p => groupById[p.group_id]?.departure_date === today).length, icon: BedDouble, color: "text-amber-600" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-card border border-border rounded-xl px-4 py-3 text-center">
                <Icon className={`w-4 h-4 ${color} mx-auto mb-1`} />
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Upcoming groups */}
        <DayGroupedList items={upcoming} emptyText={emptyText()} />

        {/* Past groups — collapsed */}
        {past.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none py-1">
              {past.length} קבוצות עבר
            </summary>
            <div className="space-y-2 mt-2 opacity-60">
              {past.map(renderRow)}
            </div>
          </details>
        )}

      </div>
    </div>
  );
}