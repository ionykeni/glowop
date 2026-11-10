import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { ChevronLeft, ChevronRight, BedDouble, Clock, Sun, Layout, CalendarDays, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import GroupAllocationCard from "@/components/housekeeping/GroupAllocationCard";
import DayUseGroupCard from "@/components/housekeeping/DayUseGroupCard";
import CommonSpaceHKCard from "@/components/housekeeping/CommonSpaceHKCard";
import ReviewAlertsBanner from "@/components/alerts/ReviewAlertsBanner";
import SearchBar from "@/components/search/SearchBar";
import OperationalMonthlyGroupCalendar from "@/components/calendar/OperationalMonthlyGroupCalendar";
import moment from "moment";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";
import {
  classifyHousekeepingAllocationsForDate,
  filterRowsForHousekeepingEvent,
  isAllocationRelevantOnHousekeepingDate,
} from "@/lib/housekeepingDateSemantics";

const TODAY = new Date().toISOString().slice(0, 10);
const DAYS_AHEAD = 7;

const TABS = [
  { id: "lodging",       label: "לינה",               color: "blue"   },
  { id: "dayuse",        label: "באי יום",             color: "teal"   },
  { id: "common_spaces", label: "מרחבים משותפים",      color: "purple" },
  { id: "all",           label: "הכל",                 color: "slate"  },
  { id: "calendar",      label: "לוח שנה",             color: "indigo" },
];

const TAB_COLORS = {
  blue:   { active: "bg-blue-600 text-white border-blue-600",   inactive: "bg-white text-blue-700 border-blue-200 hover:bg-blue-50"   },
  teal:   { active: "bg-teal-600 text-white border-teal-600",   inactive: "bg-white text-teal-700 border-teal-200 hover:bg-teal-50"   },
  purple: { active: "bg-purple-600 text-white border-purple-600", inactive: "bg-white text-purple-700 border-purple-200 hover:bg-purple-50" },
  slate:  { active: "bg-slate-700 text-white border-slate-700", inactive: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50" },
  indigo: { active: "bg-indigo-600 text-white border-indigo-600", inactive: "bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50" },
};

function formatDateHebrew(dateStr) {
  try {
    return format(parseISO(dateStr), "EEEE, d בMMMM yyyy", { locale: he });
  } catch {
    return dateStr;
  }
}

export default function Housekeeping() {
  const [startDate, setStartDate]   = useState(TODAY);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter]   = useState("");   // single date filter
  const [activeTab, setActiveTab]   = useState("lodging");
  const [calendarMonth, setCalendarMonth] = useState(moment());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const refetchAllocations = () => queryClient.invalidateQueries({ queryKey: ["sleepingAllocations"] });

  // ── Data fetching ─────────────────────────────────────────────────────────────
  const { data: allocations = [] } = useQuery({
    queryKey: ["sleepingAllocations"],
    queryFn: () => base44.entities.SleepingAllocation.list(),
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("-arrival_date", 300),
    select: items => items.filter(isGroupOperationallyEnabled),
  });

  const { data: tents = [] } = useQuery({
    queryKey: ["tents"],
    queryFn: () => base44.entities.Tent.list(),
  });

  const { data: neighborhoods = [] } = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: () => base44.entities.Neighborhood.list("sort_order"),
  });

  const { data: nhoodReservations = [] } = useQuery({
    queryKey: ["allNhoodReservations"],
    queryFn: () => base44.entities.NeighborhoodReservation.filter({ status: "ACTIVE" }),
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["operationalProfiles"],
    queryFn: () => base44.entities.OperationalGroupProfile.list(),
  });

  // For day-use + common spaces
  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["groupScheduleItems"],
    queryFn: () => base44.entities.GroupScheduleItem.list(),
  });
  const { data: standaloneActivities = [] } = useQuery({
    queryKey: ["standaloneActivities"],
    queryFn: () => base44.entities.StandaloneActivityReservation.filter({ status: "ACTIVE" }),
  });
  const { data: standaloneAssignments = [] } = useQuery({
    queryKey: ["standaloneActivityAssignments"],
    queryFn: () => base44.entities.StandaloneActivitySpaceAssignment.list("-created_date", 500),
  });

  const { data: activitySpaces = [] } = useQuery({
    queryKey: ["activitySpaces"],
    queryFn: () => base44.entities.ActivitySpace.list(),
  });

  const { data: mealReservations = [] } = useQuery({
    queryKey: ["mealReservations"],
    queryFn: () => base44.entities.MealReservation.list(),
  });

  // ── Lookup maps ───────────────────────────────────────────────────────────────
  const groupsMap        = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g])), [groups]);
  const operationalGroupIds = useMemo(() => new Set(groups.map(g => g.id)), [groups]);
  const operationalAllocations = useMemo(() => allocations.filter(a => operationalGroupIds.has(a.group_id)), [allocations, operationalGroupIds]);
  const operationalNhoodReservations = useMemo(() => nhoodReservations.filter(r => operationalGroupIds.has(r.group_id)), [nhoodReservations, operationalGroupIds]);
  const tentsMap         = useMemo(() => Object.fromEntries(tents.map(t => [t.id, t])), [tents]);
  const neighborhoodsMap = useMemo(() => Object.fromEntries(neighborhoods.map(n => [n.id, n])), [neighborhoods]);
  const spacesMap        = useMemo(() => Object.fromEntries(activitySpaces.map(s => [s.id, s])), [activitySpaces]);

  const nhoodResByGroup = useMemo(() => {
    const map = {};
    operationalNhoodReservations.forEach(r => {
      if (!map[r.group_id]) map[r.group_id] = [];
      map[r.group_id].push(r);
    });
    return map;
  }, [operationalNhoodReservations]);

  const profilesByGroup = useMemo(() => {
    const map = {};
    profiles.forEach(p => {
      if (!map[p.group_id]) map[p.group_id] = [];
      map[p.group_id].push(p);
    });
    return map;
  }, [profiles]);

  const draftAllocsByGroup = useMemo(() => {
    const map = {};
    operationalAllocations.filter(a => a.status === "DRAFT").forEach(a => {
      if (!map[a.group_id]) map[a.group_id] = [];
      map[a.group_id].push(a);
    });
    return map;
  }, [operationalAllocations]);

  const confirmedAllocations = useMemo(
    () => operationalAllocations.filter(a => a.status === "CONFIRMED"),
    [operationalAllocations]
  );

  const draftOnlyGroupIds = useMemo(() => {
    const confirmedGroupIds = new Set(confirmedAllocations.map(a => a.group_id));
    const draftGroupIds     = new Set(operationalAllocations.filter(a => a.status === "DRAFT").map(a => a.group_id));
    const result = new Set();
    draftGroupIds.forEach(id => { if (!confirmedGroupIds.has(id)) result.add(id); });
    return result;
  }, [operationalAllocations, confirmedAllocations]);

  const nhoodOnlyGroupIds = useMemo(() => {
    const anyAllocGroupIds = new Set(operationalAllocations.filter(a => a.status !== "CANCELLED").map(a => a.group_id));
    const nhoodGroupIds    = new Set(operationalNhoodReservations.map(r => r.group_id));
    const result = new Set();
    nhoodGroupIds.forEach(id => { if (!anyAllocGroupIds.has(id)) result.add(id); });
    return result;
  }, [operationalAllocations, operationalNhoodReservations]);

  // ── Date range ────────────────────────────────────────────────────────────────
  const dateRange = useMemo(() => {
    return Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [startDate]);

  // ── Lodging per-date data ─────────────────────────────────────────────────────
  const lodgingDateData = useMemo(() => {
    // Only lodging groups (have sleeping allocations OR group_type === LODGING)
    const lodgingGroupIds = new Set([
      ...confirmedAllocations.map(a => a.group_id),
      ...operationalAllocations.filter(a => a.status === "DRAFT").map(a => a.group_id),
      ...operationalNhoodReservations.map(r => r.group_id),
      ...groups.filter(g => g.group_type === "LODGING").map(g => g.id),
    ]);

    return dateRange.map(date => {
      const {
        checkInAllocsByGroup,
        checkOutAllocsByGroup,
        occupiedAllocsByGroup,
      } = classifyHousekeepingAllocationsForDate(confirmedAllocations, date, lodgingGroupIds);

      const lodgingGroups = groups.filter(g => lodgingGroupIds.has(g.id) && g.status !== "CANCELLED");
      const arrivingGroups = lodgingGroups.filter(g => g.stay_mode !== "MULTI_PERIOD" && g.arrival_date === date);
      const departingGroups = lodgingGroups.filter(g => g.stay_mode !== "MULTI_PERIOD" && g.departure_date === date);

      const draftCheckIn  = arrivingGroups.filter(g => !checkInAllocsByGroup[g.id]  && draftOnlyGroupIds.has(g.id));
      const nhoodCheckIn  = arrivingGroups.filter(g => !checkInAllocsByGroup[g.id]  && !draftOnlyGroupIds.has(g.id) && nhoodOnlyGroupIds.has(g.id));
      const noneCheckIn   = arrivingGroups.filter(g => !checkInAllocsByGroup[g.id]  && !draftOnlyGroupIds.has(g.id) && !nhoodOnlyGroupIds.has(g.id));
      const draftCheckOut = departingGroups.filter(g => !checkOutAllocsByGroup[g.id] && draftOnlyGroupIds.has(g.id));
      const nhoodCheckOut = departingGroups.filter(g => !checkOutAllocsByGroup[g.id] && !draftOnlyGroupIds.has(g.id) && nhoodOnlyGroupIds.has(g.id));
      const noneCheckOut  = departingGroups.filter(g => !checkOutAllocsByGroup[g.id] && !draftOnlyGroupIds.has(g.id) && !nhoodOnlyGroupIds.has(g.id));

      const checkInGroupIds  = Object.keys(checkInAllocsByGroup);
      const checkOutGroupIds = Object.keys(checkOutAllocsByGroup);
      const occupiedGroupIds = Object.keys(occupiedAllocsByGroup);

      const hasActivity =
        checkInGroupIds.length > 0 || checkOutGroupIds.length > 0 || occupiedGroupIds.length > 0 ||
        draftCheckIn.length > 0 || nhoodCheckIn.length > 0 || noneCheckIn.length > 0 ||
        draftCheckOut.length > 0 || nhoodCheckOut.length > 0;

      return {
        date,
        checkInAllocsByGroup, checkOutAllocsByGroup, occupiedAllocsByGroup,
        checkInGroupIds, checkOutGroupIds, occupiedGroupIds,
        draftCheckIn, nhoodCheckIn, noneCheckIn,
        draftCheckOut, nhoodCheckOut, noneCheckOut,
        hasActivity,
      };
    });
  }, [dateRange, confirmedAllocations, operationalAllocations, groups, operationalNhoodReservations, draftOnlyGroupIds, nhoodOnlyGroupIds]);

  // ── Day-use per-date data ─────────────────────────────────────────────────────
  const dayUseDateData = useMemo(() => {
    // Groups that are DAY_USE type and active on each date
    const dayUseGroups = groups.filter(g =>
      g.group_type === "DAY_USE" && g.status !== "CANCELLED"
    );

    return dateRange.map(date => {
      // Day-use groups whose arrival OR departure is this date, OR that span this date
      const dayUseForDate = dayUseGroups.filter(g => {
        const arrival   = g.arrival_date;
        const departure = g.departure_date;
        if (!arrival) return false;
        return arrival === date || departure === date || (arrival <= date && departure && departure > date);
      });

      const mealsForDate = mealReservations.filter(m =>
        groupsMap[m.group_id] && m.date === date && m.status === "ACTIVE"
      );
      const scheduleForDate = scheduleItems.filter(s =>
        groupsMap[s.group_id] && s.date === date && s.status === "ACTIVE"
      );

      return {
        date,
        groups: dayUseForDate,
        mealsForDate,
        scheduleForDate,
      };
    });
  }, [dateRange, groups, groupsMap, mealReservations, scheduleItems]);

  // ── Common spaces per-date data ───────────────────────────────────────────────
  const standaloneSpaceItems = useMemo(() => standaloneAssignments.flatMap((assignment) => {
    const activity = standaloneActivities.find((item) => item.id === assignment.reservation_id);
    return activity ? [{ ...assignment, id: `standalone-${assignment.id}`, standalone: true, reservation_id: activity.id, date: activity.event_date, start_time: activity.start_time, end_time: activity.end_time, activity_name: activity.title, pax: activity.expected_pax, status: activity.status, preparation_notes: activity.preparation_notes, cleanup_notes: activity.cleanup_notes }] : [];
  }), [standaloneActivities, standaloneAssignments]);
  const commonSpaceDateData = useMemo(() => {
    const bookableSpaces = activitySpaces.filter(s => s.is_bookable !== false);
    return dateRange.map(date => {
      const groupItems = scheduleItems.filter(s => groupsMap[s.group_id] && s.date === date && s.status === "ACTIVE" && s.activity_space_id);
      const itemsOnDate = [...groupItems, ...standaloneSpaceItems.filter((item) => item.date === date)];
      // Group by space
      const bySpaceId = {};
      itemsOnDate.forEach(item => {
        if (!bySpaceId[item.activity_space_id]) bySpaceId[item.activity_space_id] = [];
        bySpaceId[item.activity_space_id].push(item);
      });
      const spacesUsed = bookableSpaces.filter(s => bySpaceId[s.id]);
      return { date, bySpaceId, spacesUsed };
    });
  }, [dateRange, scheduleItems, standaloneSpaceItems, activitySpaces, groupsMap]);

  // ── Search + date filters ─────────────────────────────────────────────────────
  const matchGroup = (g) => {
    if (searchQuery) {
      const q = searchQuery.trim().toLowerCase();
      if (![g.group_name, g.contact_name].some(f => f && f.toLowerCase().includes(q))) return false;
    }
    if (dateFilter) {
      if (g.stay_mode === "MULTI_PERIOD") {
        const hasRelevantStay = operationalAllocations.some(a =>
          a.group_id === g.id && a.status !== "CANCELLED" && isAllocationRelevantOnHousekeepingDate(a, dateFilter)
        );
        if (!hasRelevantStay) return false;
      } else {
        const arr = g.arrival_date;
        const dep = g.departure_date;
        if (!arr) return false;
        if (arr > dateFilter) return false;
        if (dep && dep < dateFilter) return false;
      }
    }
    return true;
  };

  const matchGroupId = (gid) => {
    const g = groupsMap[gid];
    if (!g) return false;
    return matchGroup(g);
  };

  // ── Card prop builders (unchanged) ────────────────────────────────────────────
  const dateRelevantRows = (group, rows, date, type) =>
    group?.stay_mode === "MULTI_PERIOD" ? filterRowsForHousekeepingEvent(rows, date, type) : rows;

  const cardProps = (groupId, allocs, type, date) => {
    const group = groupsMap[groupId];
    return {
      group,
      allocations: allocs,
      draftAllocations: dateRelevantRows(group, draftAllocsByGroup[groupId] || [], date, type),
      nhoodReservations: dateRelevantRows(group, nhoodResByGroup[groupId] || [], date, type),
      profiles: profilesByGroup[groupId] || [],
      tentsMap,
      neighborhoodsMap,
      type,
      onRefresh: refetchAllocations,
    };
  };

  const warnCardProps = (group, type, date) => ({
    group,
    allocations: [],
    draftAllocations: dateRelevantRows(group, draftAllocsByGroup[group.id] || [], date, type),
    nhoodReservations: dateRelevantRows(group, nhoodResByGroup[group.id] || [], date, type),
    profiles: profilesByGroup[group.id] || [],
    tentsMap,
    neighborhoodsMap,
    type,
    onRefresh: refetchAllocations,
  });

  const hasAnyLodging     = lodgingDateData.some(d => d.hasActivity);
  const hasAnyDayUse      = dayUseDateData.some(d => d.groups.length > 0);
  const hasAnyCommon      = commonSpaceDateData.some(d => d.spacesUsed.length > 0);

  // ── Render helpers ────────────────────────────────────────────────────────────
  function renderLodgingSection({ date, checkInAllocsByGroup, checkOutAllocsByGroup, occupiedAllocsByGroup,
    checkInGroupIds, checkOutGroupIds, occupiedGroupIds,
    draftCheckIn, nhoodCheckIn, noneCheckIn, draftCheckOut, nhoodCheckOut, noneCheckOut, hasActivity }) {
    if (!hasActivity) return null;

    const hasCheckins  = checkInGroupIds.length > 0 || draftCheckIn.length > 0 || nhoodCheckIn.length > 0 || noneCheckIn.length > 0;
    const hasCheckouts = checkOutGroupIds.length > 0 || draftCheckOut.length > 0 || nhoodCheckOut.length > 0 || noneCheckOut.length > 0;
    const hasOccupied  = occupiedGroupIds.length > 0;

    return (
      <section key={date}>
        <DateHeading date={date} />
        {hasCheckins && (
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> קבוצות נכנסות
            </h3>
            <div className="space-y-2">
              {checkInGroupIds.filter(matchGroupId).map(gid => (
                <GroupAllocationCard key={gid} {...cardProps(gid, checkInAllocsByGroup[gid] || [], "checkin", date)} />
              ))}
              {draftCheckIn.filter(matchGroup).map(g => (
                <GroupAllocationCard key={g.id} {...warnCardProps(g, "checkin", date)} />
              ))}
              {nhoodCheckIn.filter(matchGroup).map(g => (
                <GroupAllocationCard key={g.id} {...warnCardProps(g, "checkin", date)} />
              ))}
              {noneCheckIn.filter(matchGroup).map(g => (
                <GroupAllocationCard key={g.id} {...warnCardProps(g, "checkin", date)} />
              ))}
            </div>
          </div>
        )}
        {hasCheckouts && (
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-500" /> קבוצות יוצאות
            </h3>
            <div className="space-y-2">
              {checkOutGroupIds.filter(matchGroupId).map(gid => (
                <GroupAllocationCard key={gid} {...cardProps(gid, checkOutAllocsByGroup[gid] || [], "checkout", date)} />
              ))}
              {draftCheckOut.filter(matchGroup).map(g => (
                <GroupAllocationCard key={g.id} {...warnCardProps(g, "checkout", date)} />
              ))}
              {nhoodCheckOut.filter(matchGroup).map(g => (
                <GroupAllocationCard key={g.id} {...warnCardProps(g, "checkout", date)} />
              ))}
              {noneCheckOut.filter(matchGroup).map(g => (
                <GroupAllocationCard key={g.id} {...warnCardProps(g, "checkout", date)} />
              ))}
            </div>
          </div>
        )}
        {hasOccupied && (
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-400" /> אוהלים תפוסים
            </h3>
            <div className="space-y-2">
              {occupiedGroupIds.filter(matchGroupId).map(gid => (
                <GroupAllocationCard key={gid} {...cardProps(gid, occupiedAllocsByGroup[gid] || [], "occupied", date)} />
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  function renderDayUseSection({ date, groups: dayGroups, mealsForDate, scheduleForDate }) {
    if (dayGroups.length === 0) return null;
    const filtered = dayGroups.filter(matchGroup);
    if (filtered.length === 0) return null;
    return (
      <section key={date}>
        <DateHeading date={date} />
        <div className="space-y-2">
          {filtered.map(g => (
            <DayUseGroupCard
              key={g.id}
              group={g}
              meals={mealsForDate.filter(m => m.group_id === g.id)}
              scheduleItems={scheduleForDate.filter(s => s.group_id === g.id)}
              spacesMap={spacesMap}
            />
          ))}
        </div>
      </section>
    );
  }

  function renderCommonSpacesSection({ date, bySpaceId, spacesUsed }) {
    if (spacesUsed.length === 0) return null;
    return (
      <section key={date}>
        <DateHeading date={date} />
        <div className="space-y-2">
          {spacesUsed.map(space => (
            <CommonSpaceHKCard
              key={space.id}
              space={space}
              items={bySpaceId[space.id] || []}
              groupsMap={groupsMap}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* ── Header ──────────────────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-card sticky top-12 sm:top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          {/* Desktop */}
          <div className="hidden sm:flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BedDouble className="w-5 h-5 text-primary" />
              <div>
                <h1 className="text-xl font-bold">משק בית</h1>
                <p className="text-xs text-muted-foreground mt-0.5">ניהול הכנה וניקיון לפי קבוצה ותאריך</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs">
                <Link to="/cleaning-hours">
                  <Clock className="w-3.5 h-3.5" /> שעות עובדות ניקיון
                </Link>
              </Button>
              <Button variant="outline" size="icon"
                onClick={() => setStartDate(d => { const nd = new Date(d); nd.setDate(nd.getDate() - 1); return nd.toISOString().slice(0, 10); })}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setStartDate(TODAY)} className="text-xs">היום</Button>
              <Button variant="outline" size="icon"
                onClick={() => setStartDate(d => { const nd = new Date(d); nd.setDate(nd.getDate() + 1); return nd.toISOString().slice(0, 10); })}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Mobile */}
          <div className="flex sm:hidden flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BedDouble className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-slate-700">משק בית</span>
              </div>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="text-sm border border-input rounded-md px-2 py-1 bg-transparent text-slate-600 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="flex-1 h-10 text-sm gap-1"
                onClick={() => setStartDate(d => { const nd = new Date(d); nd.setDate(nd.getDate() - 1); return nd.toISOString().slice(0, 10); })}>
                <ChevronRight className="w-4 h-4" /> יום קודם
              </Button>
              <Button variant="outline" size="sm" className="h-10 px-4 text-sm font-semibold"
                onClick={() => setStartDate(TODAY)}>
                היום
              </Button>
              <Button variant="outline" size="sm" className="flex-1 h-10 text-sm gap-1"
                onClick={() => setStartDate(d => { const nd = new Date(d); nd.setDate(nd.getDate() + 1); return nd.toISOString().slice(0, 10); })}>
                יום הבא <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {TABS.map(tab => {
              const cfg = TAB_COLORS[tab.color];
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${isActive ? cfg.active : cfg.inactive}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Search + date filter */}
        <div className="flex flex-wrap items-end gap-3">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="חפש קבוצה לפי שם..."
            className="max-w-xs"
          />
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5" /> סינון לפי תאריך
              </label>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary/30 bg-white"
              />
            </div>
            {(dateFilter || searchQuery) && (
              <button
                onClick={() => { setDateFilter(""); setSearchQuery(""); }}
                className="flex items-center gap-1 text-xs text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors mb-0.5"
              >
                <X className="w-3.5 h-3.5" /> נקה סינון
              </button>
            )}
          </div>
        </div>

        {/* Alerts (lodging & all) */}
        {(activeTab === "lodging" || activeTab === "all") && (
          <ReviewAlertsBanner module="HOUSEKEEPING" />
        )}

        {/* ── לינה ──────────────────────────────────────────────────────────────── */}
        {(activeTab === "lodging") && (
          <>
            {!hasAnyLodging && <EmptyState icon={<BedDouble className="w-10 h-10 mx-auto mb-3 opacity-20" />} message="אין קבוצות לינה בתקופה הנבחרת" />}
            {lodgingDateData.map(renderLodgingSection)}
          </>
        )}

        {/* ── באי יום ───────────────────────────────────────────────────────────── */}
        {(activeTab === "dayuse") && (
          <>
            {!hasAnyDayUse && <EmptyState icon={<Sun className="w-10 h-10 mx-auto mb-3 opacity-20" />} message="אין קבוצות יום בתקופה הנבחרת" />}
            {dayUseDateData.map(renderDayUseSection)}
          </>
        )}

        {/* ── מרחבים משותפים ────────────────────────────────────────────────────── */}
        {(activeTab === "common_spaces") && (
          <>
            {!hasAnyCommon && <EmptyState icon={<Layout className="w-10 h-10 mx-auto mb-3 opacity-20" />} message="אין מרחבים משותפים בשימוש בתקופה הנבחרת" />}
            {commonSpaceDateData.map(renderCommonSpacesSection)}
          </>
        )}

        {/* ── לוח שנה ───────────────────────────────────────────────────────────── */}
        {activeTab === "calendar" && (
          <OperationalMonthlyGroupCalendar
            groups={groups.filter(g => g.status !== "CANCELLED")}
            selectedMonth={calendarMonth}
            onMonthChange={setCalendarMonth}
            onGroupClick={g => {
              // Open housekeeping view for this group by switching to lodging tab and filtering
              setActiveTab("lodging");
              setSearchQuery(g.group_name);
            }}
            getGroupLabel={(g, dateStr) => {
              const isArr = g.arrival_date === dateStr;
              const isDep = g.departure_date === dateStr;
              if (isArr) return { label: "הגעה · משק בית", color: "bg-emerald-100 text-emerald-800 border-emerald-200" };
              if (isDep) return { label: "עזיבה · משק בית", color: "bg-orange-100 text-orange-800 border-orange-200" };
              return { label: "שוהה · משק בית", color: "bg-blue-50 text-blue-700 border-blue-200" };
            }}
          />
        )}

        {/* ── הכל ───────────────────────────────────────────────────────────── */}
        {(activeTab === "all") && (
          <div className="space-y-10">
            {dateRange.map(date => {
              const lodging = lodgingDateData.find(d => d.date === date);
              const dayuse  = dayUseDateData.find(d => d.date === date);
              const common  = commonSpaceDateData.find(d => d.date === date);

              const hasAny = lodging?.hasActivity || dayuse?.groups.length > 0 || common?.spacesUsed.length > 0;
              if (!hasAny) return null;

              return (
                <div key={date} className="space-y-4">
                  <DateHeading date={date} />

                  {/* Lodging compact */}
                  {lodging?.hasActivity && (
                    <div>
                      <SectionLabel color="blue" label="לינה" icon={<BedDouble className="w-3.5 h-3.5" />} />
                      {renderLodgingSection(lodging)}
                    </div>
                  )}

                  {/* Day-use compact */}
                  {dayuse?.groups.filter(matchGroup).length > 0 && (
                    <div>
                      <SectionLabel color="teal" label="באי יום" icon={<Sun className="w-3.5 h-3.5" />} />
                      <div className="space-y-2">
                        {dayuse.groups.filter(matchGroup).map(g => (
                          <DayUseGroupCard
                            key={g.id}
                            group={g}
                            meals={dayuse.mealsForDate.filter(m => m.group_id === g.id)}
                            scheduleItems={dayuse.scheduleForDate.filter(s => s.group_id === g.id)}
                            spacesMap={spacesMap}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Common spaces compact */}
                  {common?.spacesUsed.length > 0 && (
                    <div>
                      <SectionLabel color="purple" label="מרחבים משותפים" icon={<Layout className="w-3.5 h-3.5" />} />
                      <div className="space-y-2">
                        {common.spacesUsed.map(space => (
                          <CommonSpaceHKCard
                            key={space.id}
                            space={space}
                            items={common.bySpaceId[space.id] || []}
                            groupsMap={groupsMap}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!hasAnyLodging && !hasAnyDayUse && !hasAnyCommon && (
              <EmptyState icon={<BedDouble className="w-10 h-10 mx-auto mb-3 opacity-20" />} message="אין פעילות בתקופה הנבחרת" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function DateHeading({ date }) {
  return (
    <h2 className="text-base font-bold text-slate-700 mb-4 pb-2 border-b border-slate-200">
      {formatDateHebrew(date)}
      {date === TODAY && (
        <span className="mr-2 text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">היום</span>
      )}
    </h2>
  );
}

function SectionLabel({ color, label, icon }) {
  const colors = {
    blue:   "text-blue-700 bg-blue-50",
    teal:   "text-teal-700 bg-teal-50",
    purple: "text-purple-700 bg-purple-50",
  };
  return (
    <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-2 ${colors[color] || "text-slate-600 bg-slate-50"}`}>
      {icon}{label}
    </div>
  );
}

function EmptyState({ icon, message }) {
  return (
    <div className="text-center py-20 text-muted-foreground">
      {icon}
      <p className="text-sm">{message}</p>
    </div>
  );
}