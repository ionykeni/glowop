import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import moment from "moment";
import "moment/locale/he";
import { Layers, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import SearchBar from "@/components/search/SearchBar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sortActivitySpaces } from "@/lib/activitySpaceUtils";
import { useRoleContext } from "@/lib/RoleContext";
import { isBlockVisibleOnCalendarDate } from "@/lib/activitySpaceBlocks";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";

import SpaceOverviewCard from "../components/spaces/SpaceOverviewCard.jsx";
import SpaceDailyView from "../components/spaces/SpaceDailyView.jsx";
import SpaceWeeklyGrid from "../components/spaces/SpaceWeeklyGrid.jsx";
import LogisticsReportTab from "../components/spaces/LogisticsReportTab.jsx";
import ActivitySpaceBlocksPanel from "@/components/spaces/ActivitySpaceBlocksPanel";
import StandaloneActivityModal from "@/components/standalone-activities/StandaloneActivityModal";
import StandaloneActivitiesTab from "@/components/standalone-activities/StandaloneActivitiesTab";
import { invalidateStandaloneActivityQueries } from "@/lib/standaloneActivityQueries";
import VisualSpaceCalendar from "@/components/spaces/visual/VisualSpaceCalendar";

moment.locale("he");

export default function CommonSpaces() {
  const { role } = useRoleContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState(urlParams.get("tab") === "visual" ? "visual" : "overview");
  const [standaloneModal, setStandaloneModal] = useState(null);
  const [selectedDate, setSelectedDate] = useState(moment().format("YYYY-MM-DD"));
  const [weekPivot, setWeekPivot] = useState(moment());
  const [spaceSearch, setSpaceSearch] = useState("");

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: rawSpaces = [] } = useQuery({
    queryKey: ["spaces-list"],
    queryFn: () => base44.entities.ActivitySpace.list(),
  });
  const activitySpaces = sortActivitySpaces(rawSpaces);

  const filteredSpaces = useMemo(() => {
    const q = spaceSearch.trim().toLowerCase();
    if (!q) return activitySpaces;
    return activitySpaces.filter(s =>
      [s.name, s.code, s.notes].some(f => f && f.toLowerCase().includes(q)) ||
      (s.capacity && String(s.capacity).includes(q))
    );
  }, [activitySpaces, spaceSearch]);

  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["spaces-schedule-items"],
    queryFn: () => base44.entities.GroupScheduleItem.filter({ status: "ACTIVE" }),
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["spaces-groups"],
    queryFn: () => base44.entities.Group.list("-arrival_date", 500),
    select: items => items.filter(isGroupOperationallyEnabled),
  });

  const { data: spaceBlocks = [] } = useQuery({
    queryKey: ["activity-space-blocks"],
    queryFn: () => base44.entities.ActivitySpaceBlock.list("-start_date", 500),
  });
  const { data: standaloneActivities = [] } = useQuery({
    queryKey: ["standaloneActivities"],
    queryFn: () => base44.entities.StandaloneActivityReservation.list("-event_date", 500),
  });
  const { data: standaloneAssignments = [] } = useQuery({
    queryKey: ["standaloneActivityAssignments"],
    queryFn: () => base44.entities.StandaloneActivitySpaceAssignment.list("-created_date", 500),
  });

  useEffect(() => {
    const activityId = new URLSearchParams(window.location.search).get("activity");
    if (activityId) {
      const reservation = standaloneActivities.find((item) => item.id === activityId);
      if (reservation) setStandaloneModal(reservation);
    }
  }, [standaloneActivities]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const spaceById = useMemo(() => Object.fromEntries(activitySpaces.map((space) => [space.id, space])), [activitySpaces]);
  const standaloneById = useMemo(() => Object.fromEntries(standaloneActivities.map((item) => [item.id, item])), [standaloneActivities]);
  const assignmentsByReservation = useMemo(() => {
    const map = {};
    standaloneAssignments.forEach((item) => (map[item.reservation_id] ||= []).push(item));
    return map;
  }, [standaloneAssignments]);
  const activeStandaloneActivities = useMemo(() => standaloneActivities
    .filter((item) => item.status === "ACTIVE")
    .map((item) => {
      const assignments = assignmentsByReservation[item.id] || [];
      return { ...item, assignments, spaceNames: assignments.map((row) => spaceById[row.activity_space_id]?.name).filter(Boolean) };
    })
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time)),
  [standaloneActivities, assignmentsByReservation, spaceById]);

  // Only items that have an activity_space_id (the common-space source of truth)
  const spaceItems = useMemo(
    () => scheduleItems.filter((i) => !!i.activity_space_id && !!groupById[i.group_id]).map((i) => ({ ...i, groupName: groupById[i.group_id]?.group_name || "—", groupId: i.group_id })),
    [scheduleItems, groupById]
  );

  const standaloneSpaceItems = useMemo(() => standaloneAssignments.flatMap((assignment) => {
    const reservation = standaloneById[assignment.reservation_id];
    if (!reservation || reservation.status !== "ACTIVE") return [];
    const allAssignments = assignmentsByReservation[reservation.id] || [];
    return [{ ...assignment, id: `standalone-${assignment.id}`, reservationId: reservation.id, standalone: true, activity_space_id: assignment.activity_space_id, activity_name: reservation.title, activityName: reservation.title, date: reservation.event_date, start_time: reservation.start_time, end_time: reservation.end_time, pax: reservation.expected_pax, organizer_name: reservation.organizer_name, spaceNames: allAssignments.map((row) => spaceById[row.activity_space_id]?.name).filter(Boolean), notes: assignment.notes || reservation.preparation_notes, needs_projector: allAssignments.some((row) => row.needs_projector), needs_screen: allAssignments.some((row) => row.needs_screen), needs_microphone: allAssignments.some((row) => row.needs_microphone), needs_sound: allAssignments.some((row) => row.needs_sound), needs_whiteboard: allAssignments.some((row) => row.needs_whiteboard), needs_chair_circle: allAssignments.some((row) => row.needs_chair_circle), chairs_count: Math.max(0, ...allAssignments.map((row) => Number(row.chairs_count) || 0)), logistics_other: allAssignments.map((row) => row.logistics_other).filter(Boolean).join(", ") }];
  }), [standaloneAssignments, standaloneById, assignmentsByReservation, spaceById]);
  const allSpaceItems = useMemo(() => [...spaceItems, ...standaloneSpaceItems], [spaceItems, standaloneSpaceItems]);

  // Items per space (all dates)
  const itemsBySpaceId = useMemo(() => {
    const map = {};
    allSpaceItems.forEach((i) => {
      (map[i.activity_space_id] = map[i.activity_space_id] || []).push(i);
    });
    return map;
  }, [allSpaceItems]);

  // Items per space for selected date (daily view)
  const itemsBySpaceForDay = useMemo(() => {
    const map = {};
    allSpaceItems
      .filter((i) => i.date === selectedDate)
      .forEach((i) => {
        (map[i.activity_space_id] = map[i.activity_space_id] || []).push(i);
      });
    return map;
  }, [allSpaceItems, selectedDate]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const blocksForSelectedDay = useMemo(
    () => spaceBlocks.filter(block => isBlockVisibleOnCalendarDate(block, selectedDate)),
    [spaceBlocks, selectedDate]
  );

  const handleWeeklyDayClick = (dateStr) => {
    setSelectedDate(dateStr);
    setTab("daily");
  };

  const shiftDate = (dir) => {
    setSelectedDate((d) => moment(d).add(dir, "day").format("YYYY-MM-DD"));
  };
  const closeStandaloneModal = () => {
    setStandaloneModal(null);
    if (new URLSearchParams(window.location.search).has("activity")) navigate("/common-spaces", { replace: true });
  };
  const selectStandalone = (id) => setStandaloneModal(standaloneById[id] || null);
  const cancelStandalone = async (activity) => {
    const reason = window.prompt("סיבת ביטול (אופציונלי)", "");
    if (reason === null) return;
    await base44.functions.invoke("cancelStandaloneActivityReservation", { id: activity.id, reason });
    await invalidateStandaloneActivityQueries(queryClient);
  };

  const TABS = [
    { id: "overview",  label: "סקירה כללית" },
    { id: "daily",     label: "יומי" },
    { id: "weekly",    label: "שבועי" },
    { id: "visual",    label: "יומן חזותי" },
    { id: "standalone", label: `פעילויות כלליות (${activeStandaloneActivities.length})` },
    { id: "blocks",    label: "חסימות מרחבים" },
    { id: "logistics", label: "📋 דוח לוגיסטיקה" },
  ];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 space-y-5">

        {/* Page header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Layers className="w-5 h-5 text-primary" />מרחבי פעילות</h1>
            <p className="text-sm text-muted-foreground">פעילויות קבוצתיות וכלליות במרחבים המשותפים</p>
          </div>
          {["SUPER_ADMIN", "ADMIN", "OPERATIONS"].includes(role) && <Button onClick={() => setStandaloneModal("new")}><Plus className="w-4 h-4" /> פעילות כללית ללא קבוצה</Button>}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 bg-slate-100 rounded-lg p-1 w-fit max-w-full">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                tab === t.id
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {tab === "overview" && (
          <div className="space-y-4">
            <SearchBar
              value={spaceSearch}
              onChange={setSpaceSearch}
              placeholder="חפש לפי שם מרחב, קיבולת, ציוד..."
              className="max-w-sm"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredSpaces.map((space) => (
                <SpaceOverviewCard
                  key={space.id}
                  space={space}
                  items={itemsBySpaceId[space.id] || []}
                  onSelectDay={(date) => {
                    setSelectedDate(date);
                    setTab("daily");
                  }}
                  onSelectStandalone={selectStandalone}
                />
              ))}
              {filteredSpaces.length === 0 && (
                <p className="col-span-4 text-sm text-slate-400 text-center py-12">
                  {spaceSearch ? "לא נמצאו תוצאות" : "לא נמצאו מרחבי פעילות במלאי."}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── DAILY TAB ────────────────────────────────────────────────────── */}
        {tab === "daily" && (
          <div className="space-y-4">
            {/* Date picker controls */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => shiftDate(-1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <Button size="sm" variant="outline" onClick={() => shiftDate(1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedDate(moment().format("YYYY-MM-DD"))}
                className="px-3"
              >
                היום
              </Button>
              <span className="text-sm font-semibold text-slate-700">
                {moment(selectedDate).format("dddd, D MMMM YYYY")}
              </span>
            </div>

            <SpaceDailyView
              spaces={activitySpaces}
              itemsBySpace={itemsBySpaceForDay}
              blocks={blocksForSelectedDay}
              date={selectedDate}
              onSelectStandalone={selectStandalone}
              />
          </div>
        )}

        {tab === "visual" && <VisualSpaceCalendar initialDate={urlParams.get("date")} />}

        {tab === "standalone" && (
          <StandaloneActivitiesTab activities={activeStandaloneActivities} onSelect={selectStandalone} onCancel={cancelStandalone} canCancel={["SUPER_ADMIN", "ADMIN"].includes(role)} />
        )}

        {tab === "blocks" && (
          <ActivitySpaceBlocksPanel spaces={activitySpaces} blocks={spaceBlocks} role={role} />
        )}

        {/* ── LOGISTICS REPORT TAB ─────────────────────────────────────────── */}
        {tab === "logistics" && <LogisticsReportTab />}

        {/* ── WEEKLY TAB ───────────────────────────────────────────────────── */}
        {tab === "weekly" && (
          <div className="space-y-4">
            {/* Week navigation */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setWeekPivot((p) => p.clone().subtract(1, "week"))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWeekPivot(moment())} className="px-3">
                השבוע
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWeekPivot((p) => p.clone().add(1, "week"))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-semibold text-slate-700">
                {weekPivot.clone().startOf("isoWeek").format("D MMM")}
                {" – "}
                {weekPivot.clone().endOf("isoWeek").format("D MMM YYYY")}
              </span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <SpaceWeeklyGrid
                spaces={activitySpaces}
                allItems={allSpaceItems}
                blocks={spaceBlocks}
                pivot={weekPivot}
                onSelectDay={handleWeeklyDayClick}
                onSelectStandalone={selectStandalone}
                />
            </div>

            <p className="text-xs text-slate-400">
              לחץ על תא עם הזמנות כדי לעבור לתצוגה יומית.
            </p>
          </div>
        )}

      </div>
      {standaloneModal && <StandaloneActivityModal reservation={standaloneModal === "new" ? null : standaloneModal} assignments={standaloneModal === "new" ? [] : assignmentsByReservation[standaloneModal.id] || []} spaces={activitySpaces.filter((space) => space.is_bookable !== false && (!space.working_status || space.working_status === "WORKING"))} canEdit={["SUPER_ADMIN", "ADMIN", "OPERATIONS"].includes(role)} canDelete={["SUPER_ADMIN", "ADMIN"].includes(role)} onChanged={async () => invalidateStandaloneActivityQueries(queryClient)} onClose={closeStandaloneModal} />}
    </div>
  );
}