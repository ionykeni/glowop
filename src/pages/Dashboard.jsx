import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { format, addDays } from "date-fns";
import { he } from "date-fns/locale";
import { useEffect, useState, useMemo } from "react";
import { isBlockVisibleInDashboardAlert } from "@/lib/activitySpaceBlocks";
import DashboardSummaryCards, { SECTION_IDS } from "@/components/dashboard/DashboardSummaryCards";
import DashboardGroupCard from "@/components/dashboard/DashboardGroupCard";
import DashboardWarnings from "@/components/dashboard/DashboardWarnings";
import DashboardMealsToday from "@/components/dashboard/DashboardMealsToday";
import DashboardActivitiesToday from "@/components/dashboard/DashboardActivitiesToday";
import DashboardSpaceBlocksAlert from "@/components/dashboard/DashboardSpaceBlocksAlert";
import DashboardQuickLinks from "@/components/dashboard/DashboardQuickLinks";
import OccupancyMap from "@/components/dashboard/OccupancyMap";
import DailyStaffBrief from "@/components/dashboard/brief/DailyStaffBrief";
import { Button } from "@/components/ui/button";
import { FileText, ChevronRight, ChevronLeft, BedDouble, Sun, Users, LogIn, LogOut, UtensilsCrossed, CalendarDays, AlertTriangle, Coffee } from "lucide-react";
import { useRoleContext } from "@/lib/RoleContext";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";
import { isGroupArrivalOnDate, isGroupDepartureOnDate, isGroupOnDashboardDate, isGroupSleepingNightOnDate } from "@/lib/groupDateReaders";
import useGroupStayPeriods from "@/hooks/useGroupStayPeriods";
import { hasNoSleepingTonight } from "@/lib/pendingSleepingForDate";
import YesterdaySnapshotWarning from "@/components/dashboard/YesterdaySnapshotWarning";
import StaffNotesSection from "@/components/dashboard/StaffNotesSection";
import DashboardOperationsShifts from "@/components/dashboard/DashboardOperationsShifts";

const toDateStr = (date) => format(date, "yyyy-MM-dd");
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const SNAPSHOT_CHUNK_FIELDS = [
  "snapshot_json", "snapshot_json_part_2", "snapshot_json_part_3", "snapshot_json_part_4",
  "snapshot_json_part_5", "snapshot_json_part_6", "snapshot_json_part_7", "snapshot_json_part_8",
  "snapshot_json_part_9", "snapshot_json_part_10", "snapshot_json_part_11", "snapshot_json_part_12",
  "snapshot_json_part_13", "snapshot_json_part_14", "snapshot_json_part_15", "snapshot_json_part_16",
];

function Section({ title, children, id, icon: Icon }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-20">
      <h2 className="font-bold text-base text-foreground flex items-center gap-2 border-b border-border pb-1.5">
        {Icon && <Icon className="w-4 h-4 text-slate-500" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── Pax debug panel (admin only) ────────────────────────────────────────

function PaxDebugPanel({ activeGroups, profileByGroupId }) {
  const [open, setOpen] = useState(false);
  const { role } = useRoleContext();
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs" dir="rtl">
      <button
        className="font-semibold text-amber-800 hover:underline"
        onClick={() => setOpen(v => !v)}
      >
        🔍 ניפוי: אנשים באתר ({activeGroups.reduce((s, g) => {
          const p = profileByGroupId[g.id];
          return s + (p?.total_pax ?? g.total_pax ?? 0);
        }, 0)}) — {open ? "הסתר" : "הצג פירוט"}
      </button>
      {open && (
        <table className="mt-2 w-full text-right border-collapse">
          <thead>
            <tr className="text-amber-700">
              <th className="border border-amber-200 px-2 py-1">שם קבוצה</th>
              <th className="border border-amber-200 px-2 py-1">סוג</th>
              <th className="border border-amber-200 px-2 py-1">הגעה</th>
              <th className="border border-amber-200 px-2 py-1">עזיבה</th>
              <th className="border border-amber-200 px-2 py-1">סטטוס</th>
              <th className="border border-amber-200 px-2 py-1">pax</th>
            </tr>
          </thead>
          <tbody>
            {activeGroups.map(g => {
              const p = profileByGroupId[g.id];
              const pax = p?.total_pax ?? g.total_pax ?? 0;
              return (
                <tr key={g.id} className="even:bg-amber-100/40">
                  <td className="border border-amber-200 px-2 py-1">{g.group_name}</td>
                  <td className="border border-amber-200 px-2 py-1">{g.group_type}</td>
                  <td className="border border-amber-200 px-2 py-1">{g.arrival_date}</td>
                  <td className="border border-amber-200 px-2 py-1">{g.departure_date || "—"}</td>
                  <td className="border border-amber-200 px-2 py-1">{g.status}</td>
                  <td className="border border-amber-200 px-2 py-1 font-bold">{pax}</td>
                </tr>
              );
            })}
            {activeGroups.length === 0 && (
              <tr><td colSpan={6} className="text-center text-amber-600 py-2 border border-amber-200">אין קבוצות פעילות כרגע</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [activeFilter, setActiveFilter] = useState(null);
  const [alertNow, setAlertNow] = useState(() => new Date());
  const { role } = useRoleContext();
  const canViewSpaceBlocks = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "MAINTENANCE"].includes(role);
  const isToday = selectedDate === TODAY;
  const isPast = selectedDate < TODAY;

  const { data: snapshotRecords = [], isLoading: isSnapshotLoading } = useQuery({
    queryKey: ["operationalDaySnapshot", selectedDate],
    queryFn: () => base44.entities.OperationalDaySnapshot.filter({ date: selectedDate }),
    enabled: isPast,
  });
  const historicalSnapshot = isPast ? snapshotRecords[0] || null : null;
  const snapshotPayload = useMemo(() => {
    if (!historicalSnapshot?.snapshot_json) return null;
    const snapshotJson = SNAPSHOT_CHUNK_FIELDS.map((field) => historicalSnapshot[field]).filter(Boolean).join("");
    try { return JSON.parse(snapshotJson); } catch { return null; }
  }, [historicalSnapshot]);
  const snapshotData = snapshotPayload?.snapshot_version === 1 ? snapshotPayload.data : null;
  const hasHistoricalSnapshot = isPast && !!snapshotData;
  const historicalUnavailable = isPast && !isSnapshotLoading && !hasHistoricalSnapshot;

  useEffect(() => {
    const timer = window.setInterval(() => setAlertNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const shiftDate = (days) => {
    const d = new Date(selectedDate + "T00:00:00");
    setSelectedDate(toDateStr(addDays(d, days)));
  };

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: liveGroups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("-arrival_date", 300),
    select: items => items.filter(isGroupOperationallyEnabled),
  });
  const groups = snapshotData?.groups ?? liveGroups;

  const { periodsByGroupId: livePeriodsByGroupId } = useGroupStayPeriods(groups);
  useEffect(() => base44.entities.GroupStayPeriod.subscribe(() => queryClient.invalidateQueries({ queryKey: ['groupStayPeriods', 'active'] })), [queryClient]);
  const periodsByGroupId = useMemo(() => {
    if (!snapshotData) return livePeriodsByGroupId;
    const index = {};
    (snapshotData.group_stay_periods || []).forEach(period => { (index[period.group_id] ||= []).push(period); });
    return index;
  }, [snapshotData, livePeriodsByGroupId]);

  const { data: liveProfiles = [] } = useQuery({
    queryKey: ["operationalProfiles"],
    queryFn: () => base44.entities.OperationalGroupProfile.list("-accepted_at", 300),
  });
  const profiles = snapshotData?.profiles ?? liveProfiles;

  const { data: liveMeals = [] } = useQuery({
    queryKey: ["allMeals"],
    queryFn: () => base44.entities.MealReservation.filter({ status: "ACTIVE" }),
  });
  const meals = snapshotData?.meals ?? liveMeals;
  const { data: liveCoffeeRequests = [] } = useQuery({
    queryKey: ["coffeeCornerRequests_dashboard"],
    queryFn: () => base44.entities.CoffeeCornerRequest.filter({ status: "ACTIVE" }),
  });
  const coffeeRequests = snapshotData?.coffee_requests ?? liveCoffeeRequests;

  const { data: liveActivities = [] } = useQuery({
    queryKey: ["allActivities"],
    queryFn: () => base44.entities.GroupScheduleItem.filter({ status: "ACTIVE" }),
  });
  const activities = useMemo(() => {
    if (!snapshotData) return liveActivities;
    const combined = [...(snapshotData.activities || []), ...(snapshotData.alert_activities || [])];
    return [...new Map(combined.map(item => [item.id, item])).values()];
  }, [snapshotData, liveActivities]);
  const { data: liveStandaloneActivities = [] } = useQuery({
    queryKey: ["standaloneActivities"],
    queryFn: () => base44.entities.StandaloneActivityReservation.filter({ status: "ACTIVE" }),
  });
  const standaloneActivities = snapshotData?.standalone_activities ?? liveStandaloneActivities;
  const { data: liveStandaloneAssignments = [] } = useQuery({
    queryKey: ["standaloneActivityAssignments"],
    queryFn: () => base44.entities.StandaloneActivitySpaceAssignment.list("-created_date", 500),
  });
  const standaloneAssignments = snapshotData?.standalone_assignments ?? liveStandaloneAssignments;

  const { data: liveAllocations = [] } = useQuery({
    queryKey: ["allAllocations"],
    queryFn: () => base44.entities.SleepingAllocation.filter({ status: "CONFIRMED" }),
  });
  const allocations = snapshotData?.allocations ?? liveAllocations;

  const { data: liveFacilities = [] } = useQuery({
    queryKey: ["facilities"],
    queryFn: () => base44.entities.Facility.list(),
  });
  const facilities = snapshotData?.facilities ?? liveFacilities;

  const { data: liveTents = [] } = useQuery({
    queryKey: ["tents"],
    queryFn: () => base44.entities.Tent.list(),
  });
  const tents = snapshotData?.tents ?? liveTents;

  const { data: liveActivitySpaces = [] } = useQuery({
    queryKey: ["activitySpaces"],
    queryFn: () => base44.entities.ActivitySpace.list(),
  });
  const activitySpaces = snapshotData?.activity_spaces ?? liveActivitySpaces;

  const { data: liveActivitySpaceBlocks = [] } = useQuery({
    queryKey: ["activity-space-blocks-active"],
    queryFn: () => base44.entities.ActivitySpaceBlock.filter({ status: "ACTIVE" }),
    enabled: canViewSpaceBlocks,
  });
  const activitySpaceBlocks = snapshotData?.activity_space_blocks ?? liveActivitySpaceBlocks;

  const { data: liveNeighborhoods = [] } = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: () => base44.entities.Neighborhood.list("sort_order", 50),
  });
  const neighborhoods = snapshotData?.neighborhoods ?? liveNeighborhoods;

  // ── Lookup maps ────────────────────────────────────────────────────────
  const groupById = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g])), [groups]);
  const profileByGroupId = useMemo(() => Object.fromEntries(profiles.map(p => [p.group_id, p])), [profiles]);
  const profileById = useMemo(() => Object.fromEntries(profiles.map(p => [p.id, p])), [profiles]);
  const spaceById = useMemo(() => Object.fromEntries(activitySpaces.map(s => [s.id, s])), [activitySpaces]);
  const operationalAllocations = useMemo(() => allocations.filter(a => groupById[a.group_id]), [allocations, groupById]);
  const allocatedGroupIds = useMemo(() => new Set(operationalAllocations.map(a => a.group_id)), [operationalAllocations]);
  // Live TODAY only: sleeps tonight per stay periods, and zero confirmed allocations cover tonight.
  const pendingSleepingIds = useMemo(() => {
    if (selectedDate !== TODAY || snapshotData) return new Set();
    return new Set(groups.filter(g => !['CANCELLED','COMPLETED','ARCHIVED'].includes(g.status) && isGroupSleepingNightOnDate(g, selectedDate, periodsByGroupId[g.id] || []) && hasNoSleepingTonight(g, profileByGroupId[g.id], operationalAllocations, selectedDate)).map(g => g.id));
  }, [groups, selectedDate, snapshotData, periodsByGroupId, profileByGroupId, operationalAllocations]);

  // ── Date-filtered data ─────────────────────────────────────────────────
  const EXCLUDED = new Set(["CANCELLED", "COMPLETED", "ARCHIVED"]);
  const NEXT_DATE = toDateStr(addDays(new Date(selectedDate + "T00:00:00"), 1));

  // Active groups (lodging + day-use) on this date
  const activeGroups = useMemo(() => groups.filter(g => {
    if (EXCLUDED.has(g.status)) return false;
    return isGroupOnDashboardDate(g, selectedDate, periodsByGroupId[g.id] || []);
  }), [groups, selectedDate, periodsByGroupId]);

  // Day-use groups only
  const dayUseGroups = useMemo(() =>
    activeGroups.filter(g => g.group_type === "DAY_USE"),
    [activeGroups]
  );

  // Lodging groups only (for sleeping/night count)
  const lodgingGroups = useMemo(() =>
    activeGroups.filter(g => g.group_type === "LODGING"),
    [activeGroups]
  );

  const arrivingToday = useMemo(() =>
    groups.filter(g => !EXCLUDED.has(g.status) && isGroupArrivalOnDate(g, selectedDate, periodsByGroupId[g.id] || [])),
    [groups, selectedDate, periodsByGroupId]
  );

  // Lodging groups that sleep tonight (not day-use, departure-exclusive)
  const sleepingTonight = useMemo(() => groups.filter(g => {
    if (EXCLUDED.has(g.status)) return false;
    return isGroupSleepingNightOnDate(g, selectedDate, periodsByGroupId[g.id] || []);
  }), [groups, selectedDate, periodsByGroupId]);

  // ★ Only LODGING groups can check-out. Day-use groups are NOT departures.
  const departingToday = useMemo(() =>
    groups.filter(g => !EXCLUDED.has(g.status) && g.group_type === "LODGING" && isGroupDepartureOnDate(g, selectedDate, periodsByGroupId[g.id] || [])),
    [groups, selectedDate, periodsByGroupId]
  );

  const mealsForDate = useMemo(() =>
    meals.filter(m => groupById[m.group_id] && m.date === selectedDate),
    [meals, groupById, selectedDate]
  );
  const coffeeForDate = useMemo(() =>
    coffeeRequests.filter(request => groupById[request.group_id] && request.date === selectedDate),
    [coffeeRequests, groupById, selectedDate]
  );

  const activitiesForDate = useMemo(() => {
    const groupActivities = activities.filter(a => groupById[a.group_id] && a.date === selectedDate);
    const standalone = standaloneActivities.filter(a => a.event_date === selectedDate).map((activity) => {
      const activityAssignments = standaloneAssignments.filter((assignment) => assignment.reservation_id === activity.id);
      return { ...activity, standalone: true, activity_name: activity.title, date: activity.event_date, pax: activity.expected_pax, spaceNames: activityAssignments.map((assignment) => spaceById[assignment.activity_space_id]?.name).filter(Boolean) };
    });
    return [...groupActivities, ...standalone];
  }, [activities, standaloneActivities, standaloneAssignments, groupById, spaceById, selectedDate]);

  const realToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(alertNow);
  const viewingToday = selectedDate === realToday;
  const spaceBlockAlertReference = viewingToday ? alertNow : new Date(`${selectedDate}T00:00:00`);
  const spaceBlockAlertEndDateTime = addDays(spaceBlockAlertReference, 14);
  if (!viewingToday) spaceBlockAlertEndDateTime.setHours(23, 59, 59, 999);
  const spaceBlockAlertEnd = toDateStr(spaceBlockAlertEndDateTime);
  const upcomingSpaceBlocks = useMemo(() =>
    activitySpaceBlocks
      .filter(block => isBlockVisibleInDashboardAlert(block, spaceBlockAlertReference, spaceBlockAlertEndDateTime))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.start_time.localeCompare(b.start_time)),
    [activitySpaceBlocks, spaceBlockAlertReference, spaceBlockAlertEndDateTime]
  );

  const activitiesForSpaceBlockAlert = useMemo(() =>
    activities.filter(activity =>
      groupById[activity.group_id] &&
      activity.date >= selectedDate &&
      activity.date <= spaceBlockAlertEnd &&
      activity.activity_space_id
    ),
    [activities, groupById, selectedDate, spaceBlockAlertEnd]
  );

  // ── Stats ──────────────────────────────────────────────────────────────
  const totalPaxOnSite = useMemo(() =>
    activeGroups.reduce((sum, g) => {
      const p = profileByGroupId[g.id];
      return sum + (p?.total_pax ?? g.total_pax ?? 0);
    }, 0),
    [activeGroups, profileByGroupId]
  );

  const brokenFacilities = useMemo(() => facilities.filter(f => f.working_status !== "WORKING"), [facilities]);
  const brokenTents = useMemo(() => tents.filter(t => t.working_status !== "WORKING"), [tents]);
  const maintenanceIssues = brokenFacilities.length + brokenTents.length;

  const pendingHousekeepingProfiles = useMemo(() =>
    profiles.filter(p => groupById[p.group_id] && p.sleeping_requirements_completed && !allocatedGroupIds.has(p.group_id)),
    [profiles, allocatedGroupIds, groupById]
  );

  const liveStats = {
    activeGroups:        lodgingGroups.length,
    arrivingToday:       arrivingToday.filter(g => g.group_type === "LODGING").length,
    sleepingTonight:     sleepingTonight.length,
    departingToday:      departingToday.length,
    dayUseGroups:        dayUseGroups.length,
    totalPaxOnSite,
    mealsToday:          mealsForDate.length,
    activitiesToday:     activitiesForDate.length,
    pendingHousekeeping: pendingHousekeepingProfiles.length,
    maintenanceIssues,
  };
  const stats = snapshotPayload?.derived?.summary_cards ?? liveStats;

  // ── Operational warnings (LODGING ONLY for sleeping alerts) ────────────

  // ★ FIX: Only check LODGING groups for sleeping requirement alerts
  const arrivingLodging = useMemo(() =>
    arrivingToday.filter(g => g.group_type === "LODGING"),
    [arrivingToday]
  );

  const arrivingNoSleeping = useMemo(() =>
    arrivingLodging
      .map(g => profileByGroupId[g.id])
      .filter(p => p && !p.sleeping_requirements_completed)
      .map(p => ({ id: p.group_id, label: groupById[p.group_id]?.group_name || p.group_id })),
    [arrivingLodging, profileByGroupId, groupById]
  );

  const arrivingNextLodging = useMemo(() =>
    groups.filter(g => g.arrival_date === NEXT_DATE && g.group_type === "LODGING"),
    [groups, NEXT_DATE]
  );

  const arrivingNextNoSleeping = useMemo(() =>
    arrivingNextLodging
      .map(g => profileByGroupId[g.id])
      .filter(p => p && !p.sleeping_requirements_completed)
      .map(p => ({ id: p.group_id, label: groupById[p.group_id]?.group_name || p.group_id })),
    [arrivingNextLodging, profileByGroupId, groupById]
  );

  const arrivingSoonGroupIds = useMemo(() =>
    new Set(groups.filter(g => g.arrival_date === selectedDate || g.arrival_date === NEXT_DATE).map(g => g.id)),
    [groups, selectedDate, NEXT_DATE]
  );

  const arrivingSoonPendingAllocation = useMemo(() =>
    profiles
      .filter(p => p.sleeping_requirements_completed && !allocatedGroupIds.has(p.group_id) && arrivingSoonGroupIds.has(p.group_id))
      .map(p => ({ id: p.group_id, label: groupById[p.group_id]?.group_name || p.group_id })),
    [profiles, allocatedGroupIds, arrivingSoonGroupIds, groupById]
  );

  const brokenItemsList = useMemo(() => [
    ...brokenFacilities.map(f => ({ id: f.id, label: `מתקן: ${f.label} (${f.working_status})` })),
    ...brokenTents.map(t => ({ id: t.id, label: `אוהל: ${t.code} (${t.working_status})` })),
  ], [brokenFacilities, brokenTents]);

  const liveWarnings = { arrivingNoSleeping, arrivingNextNoSleeping, arrivingSoonPendingAllocation, brokenItems: brokenItemsList };
  const warnings = snapshotPayload?.derived?.warnings ?? liveWarnings;

  // ── Per-group counts ───────────────────────────────────────────────────
  const mealsByGroup = useMemo(() => {
    const map = {};
    mealsForDate.forEach(m => { map[m.group_id] = (map[m.group_id] || 0) + 1; });
    return map;
  }, [mealsForDate]);

  const activitiesByGroup = useMemo(() => {
    const map = {};
    activitiesForDate.forEach(a => { map[a.group_id] = (map[a.group_id] || 0) + 1; });
    return map;
  }, [activitiesForDate]);

  const selectedDateDisplay = format(new Date(selectedDate + "T00:00:00"), "EEEE, d בMMMM yyyy", { locale: he });

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              דאשבורד יומי
              {isToday && (
                <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">היום</span>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">{selectedDateDisplay}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => window.open(`/daily-print?date=${selectedDate}`, "_blank")}
          >
            <FileText className="w-3.5 h-3.5" /> הפק סיכום יומי
          </Button>
        </div>

        <YesterdaySnapshotWarning />

        {/* ── Date navigation ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => shiftDate(-1)} className="gap-1 h-9">
              <ChevronRight className="w-4 h-4" /> יום קודם
            </Button>
            <Button
              size="sm"
              variant={isToday ? "default" : "outline"}
              onClick={() => setSelectedDate(TODAY)}
              className="h-9 px-3"
            >
              היום
            </Button>
            <Button size="sm" variant="outline" onClick={() => shiftDate(1)} className="gap-1 h-9">
              יום הבא <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            className="border border-input bg-transparent rounded-md px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {isSnapshotLoading && isPast && (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">טוען צילום מצב היסטורי…</div>
        )}
        {hasHistoricalSnapshot && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">נתונים היסטוריים · נשמרו בסוף היום</div>
        )}
        {historicalUnavailable && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">נתונים משוחזרים · ייתכן ששינויים מאוחרים משפיעים על התצוגה</div>
        )}

        {!isSnapshotLoading && <>
        <StaffNotesSection selectedDate={selectedDate} />
        {canViewSpaceBlocks && upcomingSpaceBlocks.length > 0 && (
          <DashboardSpaceBlocksAlert blocks={upcomingSpaceBlocks} activities={activitiesForSpaceBlockAlert} />
        )}

        {/* ── Daily staff brief (generate-and-copy) ────────────────────── */}
        {!isPast && <DailyStaffBrief selectedDate={selectedDate} />}

        <DashboardOperationsShifts selectedDate={selectedDate} />

        {/* ── Summary cards (clickable) ────────────────────────────────── */}
        <DashboardSummaryCards
          stats={stats}
          isToday={isToday}
          activeFilter={activeFilter}
          onFilterClick={setActiveFilter}
        />

        {/* Admin pax debug panel */}
        <PaxDebugPanel activeGroups={lodgingGroups} profileByGroupId={profileByGroupId} />

        {/* ── VISUAL OCCUPANCY MAP ── THE CENTERPIECE ──────────────────── */}
        <Section id={SECTION_IDS.occupancy} title="מפת תפוסה יומית" icon={BedDouble}>
          <OccupancyMap
            selectedDate={selectedDate}
            neighborhoods={neighborhoods}
            tents={tents}
            allocations={operationalAllocations}
            groups={groups}
            periodsByGroupIdOverride={snapshotData ? periodsByGroupId : null}
          />
        </Section>

        {/* ── Group movement sections ──────────────────────────────────── */}

        {/* Arriving lodging */}
        {arrivingToday.filter(g => g.group_type === "LODGING").length > 0 && (
          <Section id={SECTION_IDS.arriving} title={`קבוצות נכנסות (${arrivingToday.filter(g => g.group_type === "LODGING").length})`} icon={LogIn}>
            <div className="space-y-2">
              {arrivingToday.filter(g => g.group_type === "LODGING").map(g => (
                <DashboardGroupCard
                  key={g.id}
                  group={g}
                  profile={profileByGroupId[g.id]}
                  mode="arriving"
                  sleepingPending={pendingSleepingIds.has(g.id)}
                  stayPeriod={g.stay_mode === 'MULTI_PERIOD' ? (periodsByGroupId[g.id] || []).find(p => p.status === 'ACTIVE' && p.start_date === selectedDate) : null}
                  />
              ))}
            </div>
          </Section>
        )}

        {/* Sleeping tonight */}
        {sleepingTonight.length > 0 && (
          <Section id={SECTION_IDS.sleeping} title={`לנים בלילה (${sleepingTonight.length})`} icon={Users}>
            <div className="space-y-2">
              {sleepingTonight.map(g => (
                <DashboardGroupCard
                  key={g.id}
                  group={g}
                  profile={profileByGroupId[g.id]}
                  mealsToday={mealsByGroup[g.id] || 0}
                  activitiesToday={activitiesByGroup[g.id] || 0}
                  mode="sleeping"
                  sleepingPending={pendingSleepingIds.has(g.id)}
                  stayPeriod={g.stay_mode === 'MULTI_PERIOD' ? (periodsByGroupId[g.id] || []).find(p => p.status === 'ACTIVE' && p.start_date <= selectedDate && selectedDate < p.end_date) : null}
                  />
              ))}
            </div>
          </Section>
        )}

        {/* Departing */}
        {departingToday.length > 0 && (
          <Section id={SECTION_IDS.departing} title={`קבוצות יוצאות (${departingToday.length})`} icon={LogOut}>
            <div className="space-y-2">
              {departingToday.map(g => (
                <DashboardGroupCard
                  key={g.id}
                  group={g}
                  profile={profileByGroupId[g.id]}
                  mode="departing"
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Day-use groups ───────────────────────────────────────────── */}
        {dayUseGroups.length > 0 && (
          <Section id={SECTION_IDS.dayUse} title={`באי יום (${dayUseGroups.length})`} icon={Sun}>
            <div className="space-y-2">
              {dayUseGroups.map(g => (
                <DashboardGroupCard
                  key={g.id}
                  group={g}
                  profile={profileByGroupId[g.id]}
                  mode="dayuse"
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Meals ────────────────────────────────────────────────────── */}
        <Section id={SECTION_IDS.meals} title={`ארוחות (${mealsForDate.length})`} icon={UtensilsCrossed}>
          <DashboardMealsToday meals={mealsForDate} groupById={groupById} profileById={profileById} />
        </Section>

        {coffeeForDate.length > 0 && (
          <Section title={`פינות קפה (${coffeeForDate.length})`} icon={Coffee}>
            <DashboardMealsToday meals={coffeeForDate} groupById={groupById} profileById={profileById} />
          </Section>
        )}

        {/* ── Activities ───────────────────────────────────────────────── */}
        <Section id={SECTION_IDS.activities} title={`פעילויות (${activitiesForDate.length})`} icon={CalendarDays}>
          <DashboardActivitiesToday activities={activitiesForDate} groupById={groupById} spaceById={spaceById} />
        </Section>

        {/* ── Alerts ───────────────────────────────────────────────────── */}
        <Section id={SECTION_IDS.warnings} title="התראות תפעוליות" icon={AlertTriangle}>
          <DashboardWarnings warnings={warnings} selectedDate={selectedDate} today={TODAY} />
        </Section>

        {/* ── Quick links ──────────────────────────────────────────────── */}
        {role !== "QUOTES_MANAGER" && <Section title="קישורים מהירים">
          <DashboardQuickLinks />
        </Section>}
        </>}

      </div>
    </div>
  );
}