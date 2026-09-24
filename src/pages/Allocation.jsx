import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, Users, ChevronDown, ChevronUp, CheckCircle2, Clock, AlertCircle, AlertTriangle, Shield, Car, CalendarDays } from "lucide-react";
import SearchBar from "@/components/search/SearchBar";
import DateRangeFilter from "@/components/search/DateRangeFilter";
import { Button } from "@/components/ui/button";
import SleepingAllocationTab from "@/components/sleeping/SleepingAllocationTab";
import ReviewAlertsBanner from "@/components/alerts/ReviewAlertsBanner";
import { computeAllocationCounts } from "@/lib/allocationCounts";
import OperationalMonthlyGroupCalendar from "@/components/calendar/OperationalMonthlyGroupCalendar";
import { useNavigate } from "react-router-dom";
import moment from "moment";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";
import useGroupStayPeriods from "@/hooks/useGroupStayPeriods";
import { pendingSleepingForDate } from "@/lib/pendingSleepingForDate";

const TODAY = new Date().toISOString().slice(0, 10);

function parseDist(json) {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function distSummary(rows) {
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + (r.tent_count || 0) * (r.people_per_tent || 0), 0);
  const desc = rows.map(r => `${r.tent_count}×${r.people_per_tent}`).join(", ");
  return `${total} איש (${desc})`;
}

// ── VIP tent grid ──────────────────────────────────────────────────────────

const GENDER_CONFIG = {
  WOMEN: { label: "נשים",  bg: "bg-orange-50",  border: "border-orange-300",  text: "text-orange-700",  dot: "bg-orange-400"  },
  MEN:   { label: "גברים", bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700", dot: "bg-emerald-400" },
  GIRLS: { label: "בנות",  bg: "bg-orange-50",  border: "border-orange-300",  text: "text-orange-700",  dot: "bg-orange-400"  },
  BOYS:  { label: "בנים",  bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700", dot: "bg-emerald-400" },
};

const PURPOSE_CONFIG = {
  STAFF:    { label: "צוות",    icon: null,    iconText: "👤" },
  SECURITY: { label: "אבטחה",   icon: Shield,  iconText: null },
  DRIVER:   { label: "נהג",     icon: Car,     iconText: null },
  VIP:      { label: "VIP",     icon: null,    iconText: "⭐" },
};

function purposeLabel(purpose) {
  if (!purpose) return null;
  const key = purpose?.toUpperCase();
  return PURPOSE_CONFIG[key] || { label: purpose, icon: null, iconText: null };
}

function VipTentSquare({ row, index }) {
  const gc = GENDER_CONFIG[row.gender_group] || GENDER_CONFIG.MEN;
  const pc = purposeLabel(row.purpose);
  const IconComp = pc?.icon;

  return (
    <div className={`relative rounded-xl border-2 ${gc.border} ${gc.bg} px-3 py-3 flex flex-col items-center gap-1 min-w-[72px]`}>
      {/* Tent number */}
      <span className="absolute top-1.5 right-2 text-[9px] font-bold text-slate-400">#{index + 1}</span>

      {/* Purpose icon */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${gc.bg} border ${gc.border}`}>
        {IconComp ? <IconComp className={`w-4 h-4 ${gc.text}`} /> : <span>{pc?.iconText || "👤"}</span>}
      </div>

      {/* People count */}
      <div className="flex items-center gap-0.5">
        {Array.from({ length: Math.min(row.people_count || 1, 3) }).map((_, i) => (
          <span key={i} className={`w-2 h-2 rounded-full ${gc.dot}`} />
        ))}
      </div>

      {/* Labels */}
      <span className={`text-[10px] font-bold ${gc.text} leading-none`}>{gc.label}</span>
      {pc && <span className="text-[9px] text-slate-500 leading-none">{pc.label}</span>}
      <span className={`text-[11px] font-semibold ${gc.text}`}>{row.people_count} איש</span>
    </div>
  );
}

function VipTentGrid({ vipRows }) {
  const womenCount = vipRows.filter(r => r.gender_group === "WOMEN" || r.gender_group === "GIRLS").length;
  const menCount   = vipRows.filter(r => r.gender_group === "MEN"   || r.gender_group === "BOYS").length;

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm text-purple-800">VIP — {vipRows.length} אוהלים</p>
        <div className="flex items-center gap-2 text-[10px]">
          {menCount > 0   && <span className="bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-medium">{menCount} אוהלי גברים</span>}
          {womenCount > 0 && <span className="bg-orange-100 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5 font-medium">{womenCount} אוהלי נשים</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {vipRows.map((r, i) => <VipTentSquare key={i} row={r} index={i} />)}
      </div>
    </div>
  );
}

function AllocationStatusBadge({ allocations, profile, pendingCoverage }) {
  if (pendingCoverage) return <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5"><Clock className="w-3 h-3" /> לינה ממתינה לשיבוץ</span>;
  const active = allocations.filter(a => a.status !== "CANCELLED");
  const confirmed = active.filter(a => a.status === "CONFIRMED");
  const drafts = active.filter(a => a.status === "DRAFT");

  // Use unified counts for smarter status detection
  const counts = profile ? computeAllocationCounts(allocations, profile) : null;

  // All confirmed + fully allocated
  if (confirmed.length > 0 && drafts.length === 0) {
    if (counts && counts.totalRemaining > 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
          <AlertTriangle className="w-3 h-3" /> שיבוץ חלקי
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
        <CheckCircle2 className="w-3 h-3" /> שובץ
      </span>
    );
  }

  // Drafts exist
  if (drafts.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
        <Clock className="w-3 h-3" /> טיוטה ({drafts.length})
      </span>
    );
  }

  // Has active allocations but no drafts/confirmed (shouldn't happen, but safety)
  if (active.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
        <Clock className="w-3 h-3" /> שיבוץ חלקי
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
      <AlertCircle className="w-3 h-3" /> ממתין לשיבוץ
    </span>
  );
}

function GroupAllocationCard({ profile, group, allocations, pendingCoverage }) {
  const [open, setOpen] = useState(false);

  const boysDist = parseDist(profile.boys_tent_distribution_json);
  const girlsDist = parseDist(profile.girls_tent_distribution_json);
  const vipRows = parseDist(profile.vip_tent_requirements_json);

  const boysSummary = distSummary(boysDist);
  const girlsSummary = distSummary(girlsDist);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{group.group_name}</span>
              <AllocationStatusBadge allocations={allocations} profile={profile} pendingCoverage={pendingCoverage} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span>{group.arrival_date} — {group.departure_date}</span>
              <span className="flex items-center gap-0.5">
                <Users className="w-3 h-3" />
                {profile.total_pax ?? group.total_pax ?? "—"} אנשים
              </span>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setOpen(v => !v)}
            className="gap-1 shrink-0"
          >
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {open ? "סגור" : "פתח שיבוץ פיזי"}
          </Button>
        </div>

        {/* Requirements summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {profile.boys_beds_needed != null && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 space-y-0.5">
              <p className="font-semibold text-emerald-700">בנים — {profile.boys_beds_needed} מיטות</p>
              {boysSummary && <p className="text-emerald-600">{boysSummary}</p>}
            </div>
          )}
          {profile.girls_beds_needed != null && (
            <div className="bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 space-y-0.5">
              <p className="font-semibold text-orange-700">בנות — {profile.girls_beds_needed} מיטות</p>
              {girlsSummary && <p className="text-orange-600">{girlsSummary}</p>}
            </div>
          )}
          {vipRows.length > 0 && (
            <div className="sm:col-span-2">
              <VipTentGrid vipRows={vipRows} />
            </div>
          )}
          {profile.accessibility_sleeping_notes && (
            <div className="sm:col-span-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-800 text-[11px]">
              ♿ נגישות: {profile.accessibility_sleeping_notes}
            </div>
          )}
          {profile.housekeeping_sleeping_notes && (
            <div className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 text-[11px]">
              📋 למשק בית: {profile.housekeeping_sleeping_notes}
            </div>
          )}
        </div>
      </div>

      {/* Physical allocation panel */}
      {open && (
        <div className="border-t border-border bg-slate-50/70 px-3 py-4 sm:px-4">
          <SleepingAllocationTab groupId={group.id} />
        </div>
      )}
    </div>
  );
}

export default function Allocation() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStart, setFilterStart] = useState(null);
  const [filterEnd, setFilterEnd] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [activeView, setActiveView] = useState("list"); // "list" | "calendar"
  const [calendarMonth, setCalendarMonth] = useState(moment());
  const navigate = useNavigate();

  const { data: groups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("-arrival_date", 300),
    select: items => items.filter(isGroupOperationallyEnabled),
  });

  const { periodsByGroupId } = useGroupStayPeriods(groups);
  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ["operationalProfiles"],
    queryFn: () => base44.entities.OperationalGroupProfile.list("-accepted_at", 300),
  });

  const { data: allocations = [] } = useQuery({
    queryKey: ["allAllocations"],
    queryFn: () => base44.entities.SleepingAllocation.list(),
  });

  const loading = loadingGroups || loadingProfiles;

  // Build lookups
  const groupById = Object.fromEntries(groups.map(g => [g.id, g]));
  const profileByGroupId = Object.fromEntries(profiles.map(p => [p.group_id, p]));
  const allocationsByGroupId = {};
  allocations.forEach(a => {
    if (!allocationsByGroupId[a.group_id]) allocationsByGroupId[a.group_id] = [];
    allocationsByGroupId[a.group_id].push(a);
  });

  const pendingCoverage = (g, p) => g.stay_mode === 'MULTI_PERIOD' && (periodsByGroupId[g.id] || []).some(period => period.end_date > TODAY && pendingSleepingForDate(g, p, periodsByGroupId[g.id], allocations, period.start_date < TODAY ? TODAY : period.start_date));

  // Ready for allocation:
  // - has OperationalGroupProfile
  // - is_sleeping_group = true
  // - sleeping_requirements_completed = true
  // - group departure_date >= today (not past)
  // - group status != CANCELLED
  const readyProfiles = profiles.filter(p => {
    const g = groupById[p.group_id];
    if (!g) return false;
    if (g.status === "CANCELLED") return false;
    if (!p.is_sleeping_group) return false;
    if (!p.sleeping_requirements_completed) return false;
    if (g.departure_date && g.departure_date < TODAY) return false;
    return true;
  });

  // Sort: arriving soonest first
  const sorted = [...readyProfiles].sort((a, b) => {
    const da = groupById[a.group_id]?.arrival_date || "";
    const db = groupById[b.group_id]?.arrival_date || "";
    return da.localeCompare(db);
  });

  // Helper: get allocation status key for a profile
  const getAllocStatus = (p) => {
    if (pendingCoverage(groupById[p.group_id], p)) return 'pending';
    const allocs = allocationsByGroupId[p.group_id] || [];
    const active = allocs.filter(a => a.status !== "CANCELLED");
    const confirmed = active.filter(a => a.status === "CONFIRMED");
    if (confirmed.length > 0 && active.length === confirmed.length && !pendingCoverage(groupById[p.group_id], p)) return "allocated";
    if (active.length > 0) return "partial";
    return "pending";
  };

  // Search + date + status filter (client-side, display only)
  const filteredSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter(p => {
      const g = groupById[p.group_id];
      if (!g) return false;
      if (q && !([g.group_name, g.contact_name, g.contact_phone, g.contact_email]
        .some(f => f && f.toLowerCase().includes(q)))) return false;
      if (filterStart && g.departure_date && g.departure_date < filterStart) return false;
      if (filterEnd && g.arrival_date && g.arrival_date > filterEnd) return false;
      if (statusFilter && statusFilter !== "all") {
        const s = getAllocStatus(p);
        if (statusFilter === "allocated" && s !== "allocated") return false;
        if (statusFilter === "pending" && s !== "pending") return false;
        if (statusFilter === "partial" && s !== "partial") return false;
      }
      return true;
    });
  }, [sorted, searchQuery, filterStart, filterEnd, groupById, statusFilter, allocationsByGroupId, periodsByGroupId]);

  // Stats
  const totalReady = sorted.length;
  const fullyAllocated = sorted.filter(p => {
    const allocs = allocationsByGroupId[p.group_id] || [];
    const active = allocs.filter(a => a.status !== "CANCELLED");
    const confirmed = active.filter(a => a.status === "CONFIRMED");
    return confirmed.length > 0 && active.length === confirmed.length && !pendingCoverage(groupById[p.group_id], p);
  }).length;
  const pendingCount = totalReady - fullyAllocated;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BedDouble className="w-5 h-5 text-primary" />
              שיבוץ לינה
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              קבוצות מוכנות לשיבוץ פיזי — דרישות לינה הושלמו
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-muted border border-border rounded-full px-3 py-1 text-xs font-medium">
              {pendingCount} ממתינות · {fullyAllocated} שובצו
            </span>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setActiveView("list")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeView === "list" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                רשימה
              </button>
              <button
                onClick={() => setActiveView("calendar")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${activeView === "calendar" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                <CalendarDays className="w-3.5 h-3.5" /> לוח שנה
              </button>
            </div>
          </div>
        </div>

        {/* Allocation review alerts */}
        {activeView === "list" && <ReviewAlertsBanner module="ALLOCATION" />}

        {/* Stats strip — clickable filters */}
        <div className="grid grid-cols-3 gap-3">
          {/* All / total */}
          <button
            type="button"
            onClick={() => setStatusFilter(f => f === "all" || f === null ? null : null)}
            className={`rounded-xl px-4 py-3 text-center border transition-all ${
              !statusFilter || statusFilter === "all"
                ? "bg-primary/10 border-primary ring-2 ring-primary/30"
                : "bg-card border-border hover:bg-slate-50"
            }`}
          >
            <p className="text-2xl font-bold text-primary">{totalReady}</p>
            <p className="text-xs text-muted-foreground">הכל</p>
            {(!statusFilter || statusFilter === "all") && (
              <span className="text-[10px] text-primary font-semibold">מסנן פעיל</span>
            )}
          </button>

          {/* Pending */}
          <button
            type="button"
            onClick={() => setStatusFilter(f => f === "pending" ? null : "pending")}
            className={`rounded-xl px-4 py-3 text-center border transition-all ${
              statusFilter === "pending"
                ? "bg-amber-50 border-amber-400 ring-2 ring-amber-300"
                : "bg-card border-border hover:bg-amber-50/50"
            }`}
          >
            <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
            <p className="text-xs text-muted-foreground">ממתינות</p>
            {statusFilter === "pending" && (
              <span className="text-[10px] text-amber-600 font-semibold">מסנן פעיל</span>
            )}
          </button>

          {/* Allocated */}
          <button
            type="button"
            onClick={() => setStatusFilter(f => f === "allocated" ? null : "allocated")}
            className={`rounded-xl px-4 py-3 text-center border transition-all ${
              statusFilter === "allocated"
                ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300"
                : "bg-card border-border hover:bg-emerald-50/50"
            }`}
          >
            <p className="text-2xl font-bold text-emerald-600">{fullyAllocated}</p>
            <p className="text-xs text-muted-foreground">שובצו</p>
            {statusFilter === "allocated" && (
              <span className="text-[10px] text-emerald-600 font-semibold">מסנן פעיל</span>
            )}
          </button>
        </div>

        {/* Search & Filters */}
        <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="חפש קבוצה לפי שם, איש קשר..."
          />
          <DateRangeFilter
            startDate={filterStart}
            endDate={filterEnd}
            onStartChange={setFilterStart}
            onEndChange={setFilterEnd}
            showChips
          />
        </div>

        {/* ── Calendar view ─────────────────────────────────────────────────── */}
        {activeView === "calendar" && (
          <OperationalMonthlyGroupCalendar
            groups={sorted.map(p => groupById[p.group_id]).filter(Boolean)}
            selectedMonth={calendarMonth}
            onMonthChange={setCalendarMonth}
            onGroupClick={g => {
              // Switch to list view and scroll/highlight that group's allocation card
              setActiveView("list");
              setSearchQuery(g.group_name);
            }}
            getGroupLabel={(g, dateStr) => {
              const profile = profileByGroupId[g.id];
              const allocs = allocationsByGroupId[g.id] || [];
              const active = allocs.filter(a => a.status !== "CANCELLED");
              const confirmed = active.filter(a => a.status === "CONFIRMED");
              const counts = profile ? computeAllocationCounts(allocs, profile) : null;
              const isArr = g.arrival_date === dateStr;
              const isDep = g.departure_date === dateStr;

              let label, color;
              if (confirmed.length > 0 && active.length === confirmed.length && (!counts || counts.totalRemaining === 0)) {
                label = "שובץ";
                color = "bg-emerald-100 text-emerald-800 border-emerald-200";
              } else if (active.length > 0) {
                label = "שיבוץ חלקי";
                color = "bg-amber-100 text-amber-800 border-amber-200";
              } else {
                label = "ממתין לשיבוץ";
                color = "bg-slate-100 text-slate-600 border-slate-200";
              }
              if (isArr) { label = `הגעה · ${label}`; }
              else if (isDep) { label = `עזיבה · ${label}`; }
              return { label, color };
            }}
          />
        )}

        {activeView === "list" && (
          filteredSorted.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl text-muted-foreground text-sm">
              {statusFilter ? "לא נמצאו קבוצות בסטטוס זה" : (searchQuery || filterStart || filterEnd ? "לא נמצאו תוצאות" : "אין קבוצות הממתינות לשיבוץ כרגע")}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSorted.map(profile => {
                const group = groupById[profile.group_id];
                if (!group) return null;
                return (
                  <GroupAllocationCard
                    key={profile.id}
                    profile={profile}
                    group={group}
                    allocations={allocationsByGroupId[group.id] || []}
                    pendingCoverage={pendingCoverage(group, profile)}
                    />
                );
              })}
            </div>
          )
        )}

      </div>
    </div>
  );
}