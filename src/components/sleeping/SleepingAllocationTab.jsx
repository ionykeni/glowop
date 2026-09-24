import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Lightbulb, CheckCircle2, Shield, Trash2, Users, Plus } from "lucide-react";
import { toast } from "sonner";
import RoleGate from "@/components/RoleGate";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { computeAllocationCounts } from "@/lib/allocationCounts";
import { groupLogicalSleepingAssignments } from '@/components/sleeping/logicalSleepingView';

import SleepingRequirementsSummary from "./SleepingRequirementsSummary";
import StudentNeighborhoodPanel from "./StudentNeighborhoodPanel";
import VipAllocationPanel from "./VipAllocationPanel";
import AltTentAllocationPanel from "./AltTentAllocationPanel";
import EffectiveReassignmentPanel from "./EffectiveReassignmentPanel";
import StayPeriodSelector from "./StayPeriodSelector";
import PeriodPaxEditDialog from "./PeriodPaxEditDialog";
import PeriodTentReassignmentDialog from "./PeriodTentReassignmentDialog";
import PeriodReleaseDialog from "./PeriodReleaseDialog";
import PeriodNeighborhoodReleaseDialog from "./PeriodNeighborhoodReleaseDialog";
import PeriodAddAllocationDialog from "./PeriodAddAllocationDialog";
import TemporalScopeBadge from "./TemporalScopeBadge";
import SleepingActionButton from "./SleepingActionButton";
import HistoricalSleepingViewer from "./HistoricalSleepingViewer";
import ScopedAutoAllocation from "./ScopedAutoAllocation";
import PendingSleepingDecision from "./PendingSleepingDecision";
import { laterStayPeriods } from "@/lib/sleepingPeriodScope";
import { buildPeriodizedLocationCoverage } from "@/lib/periodizedSleepingOverview";
import { actionableSleepingRows } from '@/components/sleeping/seriesActions';

// ── helpers ────────────────────────────────────────────────────────────────

function datesOverlap(a1, a2, b1, b2) {
  if (!a1 || !a2 || !b1 || !b2) return false;
  return a1 < b2 && b1 < a2;
}

// A stay that already ended (departure_date <= today, exclusive) no longer occupies anything
function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function parseDist(json) {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function suggestNeighborhoods(neighborhoods, allTents, neededTents) {
  if (!neededTents || neededTents <= 0) return [];
  const withTents = neighborhoods
    .filter(n => !n.is_vip)
    .map(n => ({ n, tents: allTents.filter(t => t.neighborhood_id === n.id && t.working_status === "WORKING") }))
    .sort((a, b) => b.tents.length - a.tents.length);
  const suggestion = [];
  let remaining = neededTents;
  for (const { n, tents } of withTents) {
    if (remaining <= 0) break;
    const use = Math.min(tents.length, remaining);
    suggestion.push({ neighborhood: n, tents: tents.length, use, spare: tents.length - use });
    remaining -= use;
  }
  return suggestion;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SleepingAllocationTab({ groupId }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showReleaseAllDialog, setShowReleaseAllDialog] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [periodPaxTarget, setPeriodPaxTarget] = useState(null);
  const [periodLocationTarget, setPeriodLocationTarget] = useState(null);
  const [periodReleaseTarget, setPeriodReleaseTarget] = useState(null);
  const [periodNeighborhoodReleaseTarget, setPeriodNeighborhoodReleaseTarget] = useState(null);
  const [periodAddTarget, setPeriodAddTarget] = useState(null);
  // Shared neighborhood override state for confirm flow
  const [pendingSharedOverride, setPendingSharedOverride] = useState(null); // { blockedNeighborhoods, draftIds }
  const [sharedOverrideReason, setSharedOverrideReason] = useState("");

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: profiles = [] } = useQuery({
    queryKey: ["operationalProfile", groupId],
    queryFn: () => base44.entities.OperationalGroupProfile.filter({ group_id: groupId }),
    enabled: !!groupId,
  });
  const profile = profiles[0];

  const { data: group, isLoading: loadingGroup } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => base44.entities.Group.filter({ id: groupId }),
    select: r => r[0],
    enabled: !!groupId,
  });

  const { data: activeStayPeriods = [], isLoading: loadingPeriods } = useQuery({
    queryKey: ["groupStayPeriods", groupId, "active"],
    queryFn: () => base44.entities.GroupStayPeriod.filter({ group_id: groupId, status: "ACTIVE" }, "start_date", 100),
    enabled: !!groupId,
  });

  const { data: neighborhoods = [], isLoading: loadingNeighborhoods } = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: () => base44.entities.Neighborhood.list("sort_order"),
  });

  const { data: allTents = [], isLoading: loadingTents } = useQuery({
    queryKey: ["tents"],
    queryFn: () => base44.entities.Tent.list(),
  });

  const { data: myAllocations = [], isLoading: loadingAllocations } = useQuery({
    queryKey: ["sleepingAllocations", groupId],
    queryFn: () => base44.entities.SleepingAllocation.filter({ group_id: groupId }),
    enabled: !!groupId,
  });

  // All CONFIRMED allocations from OTHER groups (for VIP conflict check)
  // staleTime: 0 — conflict data must always refetch on mount, never serve stale cache
  const { data: allConfirmedAllocations = [] } = useQuery({
    queryKey: ["allConfirmedAllocations"],
    queryFn: () => base44.entities.SleepingAllocation.filter({ status: "CONFIRMED" }),
    staleTime: 0,
  });

  // All ACTIVE (DRAFT + CONFIRMED) allocations — used for alt tent tent-level conflict detection
  // staleTime: 0 — conflict data must always refetch on mount, never serve stale cache
  const { data: allActiveAllocations = [] } = useQuery({
    queryKey: ["allActiveAllocations"],
    queryFn: async () => {
      const [draft, confirmed] = await Promise.all([
        base44.entities.SleepingAllocation.filter({ status: "DRAFT" }),
        base44.entities.SleepingAllocation.filter({ status: "CONFIRMED" }),
      ]);
      return [...draft, ...confirmed];
    },
    staleTime: 0,
  });

  const { data: myNhoodReservations = [] } = useQuery({
    queryKey: ["nhoodReservations", groupId],
    queryFn: () => base44.entities.NeighborhoodReservation.filter({ group_id: groupId }),
    enabled: !!groupId,
  });

  const { data: allNhoodReservations = [] } = useQuery({
    queryKey: ["allNhoodReservations"],
    queryFn: () => base44.entities.NeighborhoodReservation.filter({ status: "ACTIVE" }),
  });

  const { data: allGroups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("-arrival_date", 300),
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const arrivalDate   = profile?.arrival_date   || group?.arrival_date   || "";
  const departureDate = profile?.departure_date || group?.departure_date || "";
  const isMultiPeriod = group?.stay_mode === "MULTI_PERIOD";
  const canUseMultiPeriod = isMultiPeriod && group?.operationally_active === true && group?.status === "CONFIRMED";
  const sortedStayPeriods = useMemo(
    () => [...activeStayPeriods].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [activeStayPeriods]
  );
  const selectedPeriod = sortedStayPeriods.find(period => period.id === selectedPeriodId) || null;
  const isPeriodView = isMultiPeriod && !!selectedPeriod;
  const periodState = selectedPeriod
    ? selectedPeriod.end_date <= todayLocal() ? "past" : selectedPeriod.start_date <= todayLocal() ? "current" : "future"
    : null;
  const periodMatches = row => selectedPeriod && (
    row.stay_period_id === selectedPeriod.id ||
    (!row.stay_period_id && datesOverlap(row.arrival_date, row.departure_date, selectedPeriod.start_date, selectedPeriod.end_date))
  );
  const displayedAllocations = isPeriodView
    ? myAllocations.filter(row => row.status !== "CANCELLED" && periodMatches(row) && (periodState !== "current" || row.departure_date > todayLocal()))
    : myAllocations;
  const displayedNhoodReservations = isPeriodView
    ? myNhoodReservations.filter(row => row.status === "ACTIVE" && periodMatches(row))
    : null;
  const visibleStayPeriods = isPeriodView ? [selectedPeriod] : activeStayPeriods;
  const logicalSeriesData = useMemo(
    () => groupLogicalSleepingAssignments(isMultiPeriod ? actionableSleepingRows(myAllocations) : myAllocations.filter(a => a.status !== "CANCELLED")),
    [myAllocations, isMultiPeriod]
  );
  const logicalStudentAssignments = useMemo(
    () => logicalSeriesData.logical_assignments.filter(a => a.allocation_type === "STUDENT"),
    [logicalSeriesData]
  );
  const displayedLogicalSeriesData = useMemo(
    () => isPeriodView ? groupLogicalSleepingAssignments(displayedAllocations) : logicalSeriesData,
    [displayedAllocations, isPeriodView, logicalSeriesData]
  );
  const locationCoverage = useMemo(
    () => isMultiPeriod && !isPeriodView ? buildPeriodizedLocationCoverage(myAllocations, sortedStayPeriods, todayLocal()) : {},
    [isMultiPeriod, isPeriodView, myAllocations, sortedStayPeriods]
  );
  const { data: remoteSeriesValidation, isFetching: checkingSeries } = useQuery({
    queryKey: ['sleepingSeriesValidation', groupId, myAllocations.map(r => `${r.id}:${r.updated_date}`).join('|'), activeStayPeriods.map(p => `${p.id}:${p.updated_date}`).join('|')],
    queryFn: async () => {
      const { data } = await base44.functions.invoke('manageMultiPeriodSleepingSeries', { action: 'inspect', group_id: groupId });
      return data?.success ? data.validation : { valid: false, status: 'INVALID_SERIES', errors: [] };
    },
    enabled: isMultiPeriod && !!groupId,
  });
  const seriesValidation = !isMultiPeriod
    ? { status: 'COMPLETE', valid: true, errors: [], loading: false }
    : checkingSeries
      ? { status: 'LOADING', valid: undefined, errors: [], loading: true }
      : remoteSeriesValidation?.valid
        ? { ...remoteSeriesValidation, loading: false }
        : { ...(remoteSeriesValidation || {}), status: 'INVALID_SERIES', valid: false, errors: remoteSeriesValidation?.errors || [], loading: false };
  const missingPeriods = sortedStayPeriods.filter(p => seriesValidation.missing_period_ids?.includes(p.id));

  const groupById = useMemo(() => Object.fromEntries(allGroups.map(g => [g.id, g])), [allGroups]);

  const myActiveNhoodRes = useMemo(
    () => myNhoodReservations.filter(r => r.status === "ACTIVE" && (!isMultiPeriod || r.departure_date > todayLocal())),
    [myNhoodReservations, isMultiPeriod]
  );
  const visibleNhoodReservations = isPeriodView ? displayedNhoodReservations : myActiveNhoodRes;
  const myNhoodResById = useMemo(
    () => Object.fromEntries(visibleNhoodReservations.map(r => [r.neighborhood_id, r])),
    [visibleNhoodReservations]
  );

  const otherNhoodResByNeighborhood = useMemo(() => {
    const map = {};
    if ((!arrivalDate || !departureDate) && !isMultiPeriod) return map;
    const today = todayLocal();
    allNhoodReservations.forEach(r => {
      if (r.group_id === groupId) return;
      if (r.departure_date <= today) return; // stay already ended
      const overlapsGroup = isMultiPeriod
        ? visibleStayPeriods.some(period => datesOverlap(period.start_date, period.end_date, r.arrival_date, r.departure_date))
        : datesOverlap(arrivalDate, departureDate, r.arrival_date, r.departure_date);
      if (!overlapsGroup) return;
      map[r.neighborhood_id] = { group_name: groupById[r.group_id]?.group_name || r.group_id, gender_group: r.gender_group };
    });
    return map;
  }, [allNhoodReservations, groupId, arrivalDate, departureDate, groupById, isMultiPeriod, visibleStayPeriods]);

  // VIP tent conflict map: tentId → { gender_group, group_id } for OTHER groups
  const vipTentConflictMap = useMemo(() => {
    const map = {};
    if ((!arrivalDate || !departureDate) && !isMultiPeriod) return map;
    const today = todayLocal();
    allConfirmedAllocations.forEach(oa => {
      if (oa.group_id === groupId) return;
      if (oa.departure_date <= today) return; // stay already ended
      const overlapsGroup = isMultiPeriod
        ? visibleStayPeriods.some(period => datesOverlap(period.start_date, period.end_date, oa.arrival_date, oa.departure_date))
        : datesOverlap(arrivalDate, departureDate, oa.arrival_date, oa.departure_date);
      if (!overlapsGroup) return;
      map[oa.tent_id] = { gender_group: oa.gender_group, group_id: oa.group_id };
    });
    return map;
  }, [allConfirmedAllocations, groupId, arrivalDate, departureDate, isMultiPeriod, visibleStayPeriods]);

  // Tent-level occupancy by OTHER groups, grouped by neighborhood — makes hidden
  // conflicts (e.g. alt-tent allocations without a neighborhood reservation) visible
  const tentConflictsByNeighborhood = useMemo(() => {
    const map = {};
    if ((!arrivalDate || !departureDate) && !isMultiPeriod) return map;
    const tentById = Object.fromEntries(allTents.map(t => [t.id, t]));
    const today = todayLocal();
    allConfirmedAllocations.forEach(oa => {
      if (oa.group_id === groupId) return;
      if (oa.departure_date <= today) return; // stay already ended
      const overlapsGroup = isMultiPeriod
        ? visibleStayPeriods.some(period => datesOverlap(period.start_date, period.end_date, oa.arrival_date, oa.departure_date))
        : datesOverlap(arrivalDate, departureDate, oa.arrival_date, oa.departure_date);
      if (!overlapsGroup) return;
      if (!oa.neighborhood_id) return;
      if (!map[oa.neighborhood_id]) map[oa.neighborhood_id] = [];
      map[oa.neighborhood_id].push({
        tent_name: tentById[oa.tent_id]?.name || tentById[oa.tent_id]?.tent_number || "?",
        group_name: groupById[oa.group_id]?.group_name || oa.group_id,
        arrival_date: oa.arrival_date,
        departure_date: oa.departure_date,
        pax: oa.allocated_pax,
      });
    });
    return map;
  }, [allConfirmedAllocations, groupId, arrivalDate, departureDate, allTents, groupById, isMultiPeriod, visibleStayPeriods]);

  // Gender split availability
  const hasGenderSplit = (Number(profile?.boys_count) + Number(profile?.girls_count)) > 0;
  const defaultGenderGroup = hasGenderSplit ? "BOYS" : "MIXED";

  // Suggestion for student neighborhoods
  const boysDist = parseDist(profile?.boys_tent_distribution_json);
  const girlsDist = parseDist(profile?.girls_tent_distribution_json);
  const totalTentsNeeded =
    boysDist.reduce((s, r) => s + (r.tent_count || 0), 0) +
    girlsDist.reduce((s, r) => s + (r.tent_count || 0), 0);

  // Neighborhood overlap is operational metadata, not physical unavailability.
  // Exact tent/date checks remain authoritative when an allocation is created.
  const availableStudentNeighborhoods = useMemo(
    () => neighborhoods.filter(n => !n.is_vip),
    [neighborhoods]
  );

  const suggestion = useMemo(
    () => suggestNeighborhoods(availableStudentNeighborhoods, allTents, totalTentsNeeded),
    [availableStudentNeighborhoods, allTents, totalTentsNeeded]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sleepingAllocations", groupId] }),
      queryClient.invalidateQueries({ queryKey: ["sleepingAllocations"] }),       // housekeeping broad key
      queryClient.invalidateQueries({ queryKey: ["allConfirmedAllocations"] }),
      queryClient.invalidateQueries({ queryKey: ["allActiveAllocations"] }),
      queryClient.invalidateQueries({ queryKey: ["allAllocations"] }),            // dashboard/housekeeping
      queryClient.invalidateQueries({ queryKey: ["nhoodReservations", groupId] }),
      queryClient.invalidateQueries({ queryKey: ["allNhoodReservations"] }),
    ]);
    if (isMultiPeriod) {
      await queryClient.invalidateQueries({ queryKey: ['sleepingSeriesValidation', groupId] });
    }
  };

  const handleReleaseAll = async () => {
    setSaving(true);
    try {
      if (isMultiPeriod) {
        const { data } = await base44.functions.invoke('manageMultiPeriodSleepingSeries', { group_id: groupId, action: 'release_all' });
        if (!data?.success) throw new Error(data?.error || 'שחרור השיבוץ נכשל');
        toast.success('שיבוצים נוכחיים ועתידיים שוחררו; ההיסטוריה נשמרה');
        invalidate();
        return;
      }
      const activeAllocs = myAllocations.filter(a => a.status !== "CANCELLED");
      const activeNhoodRes = myNhoodReservations.filter(r => r.status === "ACTIVE");

      await Promise.all([
        ...activeAllocs.map(a =>
          a.status === "DRAFT"
            ? base44.entities.SleepingAllocation.delete(a.id)
            : base44.entities.SleepingAllocation.update(a.id, { status: "CANCELLED" })
        ),
        ...activeNhoodRes.map(r =>
          base44.entities.NeighborhoodReservation.update(r.id, { status: "CANCELLED" })
        ),
      ]);

      toast.success("כל שיבוצי הלינה שוחררו ✓");
      invalidate();
    } catch (err) {
      console.error("[SleepingAllocationTab] handleReleaseAll error:", err);
      toast.error(err?.message || "שגיאה בשחרור השיבוץ — נסה שוב");
    } finally {
      setSaving(false);
      setShowReleaseAllDialog(false);
    }
  };

  const handleReserveNeighborhood = async (payload) => {
    setSaving(true);
    try {
      const existing = myActiveNhoodRes.find(r => r.neighborhood_id === payload.neighborhood_id);
      if (existing) {
        await base44.entities.NeighborhoodReservation.update(existing.id, payload);
        toast.success("שכונה עודכנה");
      } else {
        await base44.entities.NeighborhoodReservation.create(payload);
        toast.success("שכונה הוקצתה לקבוצה ✓");
      }
      invalidate();
    } catch (err) {
      console.error("[SleepingAllocationTab] handleReserveNeighborhood error:", err);
      toast.error(err?.message || "שגיאה בשמירת השכונה — נסה שוב");
    } finally {
      setSaving(false);
    }
  };

  const handleReleaseNeighborhood = async (reservationId) => {
    setSaving(true);
    try {
      // 1. Cancel the neighborhood reservation itself
      const reservation = myActiveNhoodRes.find(r => r.id === reservationId);
      const today = todayLocal();
      const hasActiveConfirmed = reservation && myAllocations.some(a => a.status === "CONFIRMED" && a.neighborhood_id === reservation.neighborhood_id && a.arrival_date <= today && a.departure_date > today);
      if (hasActiveConfirmed) {
        toast.error("שינוי מקום של שיבוץ מאושר פעיל מחייב בחירה ב׳שנה החל מתאריך׳.");
        return;
      }
      await base44.entities.NeighborhoodReservation.update(reservationId, { status: "CANCELLED" });

      // 2. Also cancel all active SleepingAllocation rows for this group in this neighborhood
      //    so that DB and UI stay in sync
      if (reservation) {
        const neighborhoodAllocs = myAllocations.filter(
          a => a.neighborhood_id === reservation.neighborhood_id && a.status !== "CANCELLED"
        );
        console.log("[SleepingAllocationTab] releasing neighborhood allocs:", neighborhoodAllocs.length, "rows");
        await Promise.all(
          neighborhoodAllocs.map(a =>
            a.status === "DRAFT"
              ? base44.entities.SleepingAllocation.delete(a.id)
              : base44.entities.SleepingAllocation.update(a.id, { status: "CANCELLED" })
          )
        );
      }

      toast.success("השכונה שוחררה וכל האוהלים הוקצאו בה בוטלו");
      invalidate();
    } catch (err) {
      console.error("[SleepingAllocationTab] handleReleaseNeighborhood error:", err);
      toast.error(err?.message || "שגיאת בשחרור השכונה — נסה שוב");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAllocations = async ({ sharedAllowed = false, sharedReason = "" } = {}) => {
    // Send locally-known draft IDs as a hint, but the backend will confirm ALL group drafts from DB.
    const draftIds = myAllocations.filter(a => a.status === "DRAFT").map(a => a.id);
    setSaving(true);
    try {
      // draft_allocation_ids may be empty — backend loads all group drafts from DB directly
      const payload = { group_id: groupId, draft_allocation_ids: draftIds };
      if (sharedAllowed && sharedReason.trim()) {
        payload.shared_neighborhood_allowed = true;
        payload.shared_neighborhood_reason = sharedReason.trim();
      }
      const confirmEndpoint = isMultiPeriod ? "confirmSleepingAllocationsCurrent" : "confirmSleepingAllocations";
      const res = await base44.functions.invoke(confirmEndpoint, payload);

      if (res.data?.success) {
        toast.success(isMultiPeriod
          ? `שיבוץ הלינה אושר — ${res.data.logical_assignment_count ?? logicalSeriesData.logical_assignment_count} שיבוצים לוגיים (${res.data.confirmed_count} שורות תקופתיות) ✓`
          : `שיבוץ הלינה אושר — ${res.data.confirmed_count} שורות ✓`);
        if (res.data.shared_override_used) toast.success("אישור שכונה משותפת נרשם ✓");
        queryClient.invalidateQueries({ queryKey: ["sleepingAllocations", groupId] });
        queryClient.invalidateQueries({ queryKey: ["allConfirmedAllocations"] });
        queryClient.invalidateQueries({ queryKey: ["allActiveAllocations"] });
        queryClient.invalidateQueries({ queryKey: ["allAllocations"] });
        queryClient.invalidateQueries({ queryKey: ["sleepingAllocations"] });
        queryClient.invalidateQueries({ queryKey: ["nhoodReservations", groupId] });
        queryClient.invalidateQueries({ queryKey: ["allNhoodReservations"] });
        queryClient.invalidateQueries({ queryKey: ["operationalProfile", groupId] });
        setPendingSharedOverride(null);
        setSharedOverrideReason("");
      } else if (res.data?.needs_shared_override) {
        // Backend says: neighborhood conflict but no tent conflict — offer shared override
        setPendingSharedOverride({
          blockedNeighborhoods: res.data.blocked_neighborhoods || [],
          draftIds,
          errors: res.data.errors || [],
        });
        setSharedOverrideReason("");
      } else {
        const errMsg = res.data?.error || null;
        const errList = res.data?.errors || (errMsg ? [errMsg] : ["שגיאה לא ידועה"]);
        console.error("[SleepingAllocationTab] Confirm allocation error:", errList, res.data?.debug);
        toast.error("לא ניתן לאשר — " + errList[0]);
        if (errList.length > 1) errList.slice(1).forEach(e => toast.error(e));
      }
    } catch (err) {
      console.error("[SleepingAllocationTab] Confirm allocation exception:", err);
      const msg = err?.response?.data?.error || err?.message || "שגיאה באישור השיבוץ — נסה שוב";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!profile) {
    return (
      <div className="text-center py-12 text-slate-400 text-sm">
        <p>אין פרופיל תפעולי מאושר לקבוצה זו.</p>
        <p className="text-xs mt-1">יש לאשר טופס קבלה כפרופיל תפעולי תחילה.</p>
      </div>
    );
  }

  if (showHistory) {
    return loadingGroup || loadingPeriods || loadingNeighborhoods || loadingTents || loadingAllocations
      ? <div className="py-8 text-center text-sm text-slate-500" dir="rtl">טוען היסטוריית שיבוץ…</div>
      : !group ? <div className="py-8 text-center text-sm text-slate-500" dir="rtl"><Button variant="outline" onClick={() => setShowHistory(false)}>חזרה לשיבוץ הנוכחי</Button> לא נמצאו פרטי קבוצה.</div>
      : <HistoricalSleepingViewer group={group} periods={activeStayPeriods} allocations={myAllocations} tents={allTents} neighborhoods={neighborhoods} today={todayLocal()} onClose={() => setShowHistory(false)} />;
  }

  const studentNeighborhoods = neighborhoods.filter(n => !n.is_vip);
  const visibleStudentNeighborhoods = isPeriodView
    ? studentNeighborhoods.filter(hood => myNhoodResById[hood.id] || displayedLogicalSeriesData.logical_assignments.some(a => a.allocation_type === "STUDENT" && a.neighborhood_id === hood.id))
    : studentNeighborhoods;
  const vipNeighborhood      = neighborhoods.find(n => n.is_vip);
  const vipTents             = vipNeighborhood
    ? allTents.filter(t => t.neighborhood_id === vipNeighborhood.id && t.working_status === "WORKING")
    : [];
  const vipRows              = parseDist(profile.vip_tent_requirements_json);

  const hasActiveAllocations = myAllocations.some(a => a.status !== "CANCELLED") ||
    myNhoodReservations.some(r => r.status === "ACTIVE");

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => setShowHistory(true)}>הצג היסטוריה</Button></div>

      {isMultiPeriod && (
        <div className="w-fit rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700" dir="ltr">
          תצוגה רב־תקופתית
        </div>
      )}

      {isMultiPeriod && (
        <StayPeriodSelector
          periods={sortedStayPeriods}
          selectedId={selectedPeriodId}
          onSelect={setSelectedPeriodId}
          today={todayLocal()}
        />
      )}

      {isPeriodView && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${periodState === "past" ? "border-slate-200 bg-slate-50 text-slate-500" : periodState === "current" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
          {periodState === "past" ? "תקופה שהסתיימה — צפייה היסטורית בלבד" : periodState === "current" ? "תקופת השהייה הנוכחית — ניתן לערוך, לשחרר ולשבץ מחדש מהיום והלאה" : "תקופת שהייה עתידית — ניתן לערוך, לשחרר ולשבץ מחדש"}
        </div>
      )}

      {seriesValidation.status === 'MISSING_COVERAGE' && missingPeriods.length > 0 && <PendingSleepingDecision groupId={groupId} periods={missingPeriods} selectedPeriod={selectedPeriod} onSelect={setSelectedPeriodId} onSaved={async () => { setSelectedPeriodId(null); await invalidate(); }} />}

       <SleepingRequirementsSummary
        profile={{ ...profile, arrival_date: arrivalDate, departure_date: departureDate }}
        allocations={isPeriodView ? displayedAllocations : isMultiPeriod ? actionableSleepingRows(myAllocations) : myAllocations}
        nhoodReservations={visibleNhoodReservations}
        allTents={allTents}
        neighborhoods={neighborhoods}
      />

      {/* Release all button */}
      {!isPeriodView && (
        <RoleGate permission="MANAGE_ALLOCATION">
          {hasActiveAllocations && (
            <div className="flex justify-end">
              <SleepingActionButton tone="destructive" onClick={() => setShowReleaseAllDialog(true)} disabled={saving}>
                <Trash2 className="w-3.5 h-3.5" /> שחרר את כל השיבוץ
              </SleepingActionButton>
            </div>
          )}
        </RoleGate>
      )}

      {/* Release all confirmation dialog */}
      <AlertDialog open={showReleaseAllDialog} onOpenChange={setShowReleaseAllDialog}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>שחרור כל שיבוצי הלינה</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-slate-600">
                <p>{isMultiPeriod ? 'פעולה זו תשחרר רק שיבוצים נוכחיים ועתידיים; שיבוצים שהסתיימו יישמרו ללא שינוי:' : 'פעולה זו תשחרר את כל שיבוצי הלינה של הקבוצה:'}</p>
                <ul className="list-disc pr-5 space-y-1">
                  <li>אוהלי תלמידים</li>
                  <li>אוהלי VIP</li>
                  <li>אוהל חילופי</li>
                  <li>הזמנות שכונה קשורות</li>
                </ul>
                <p className="text-slate-500 text-xs">הפעולה לא משנה ארוחות, פעילויות או פרטי קבוצה.</p>
                <p className="font-semibold text-red-600">להמשיך?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleReleaseAll}
              disabled={saving}
            >
              {saving ? "משחרר..." : "כן, שחרר הכל"}
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!isPeriodView && (
        <EffectiveReassignmentPanel
          group={group}
          allocations={myAllocations}
          tents={allTents}
          neighborhoods={neighborhoods}
          onSaved={invalidate}
        />
      )}

      {/* Date range */}
      {!isMultiPeriod && arrivalDate && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          📅 תאריכי לינה: <strong>{arrivalDate}</strong> — <strong>{departureDate}</strong>
          <span className="text-slate-400 mr-2">(departure_date בלעדי)</span>
        </div>
      )}

      {/* ── STUDENT NEIGHBORHOODS ── */}
      <section id="sleeping-manual-add" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
         <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">שיבוץ לפי שכונות — חניכים</h3>
          {isPeriodView && periodState !== "past" && <RoleGate permission="MANAGE_ALLOCATION"><SleepingActionButton tone="constructive" onClick={() => setPeriodAddTarget({ kind: "STUDENT" })}><Plus className="h-3 w-3" />הוסף אוהל</SleepingActionButton></RoleGate>}
          {!isMultiPeriod && totalTentsNeeded > 0 && suggestion.length > 0 && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-amber-200 text-amber-700 hover:bg-amber-50"
              onClick={() => setShowSuggestion(s => !s)}
            >
              <Lightbulb className="w-3.5 h-3.5" /> הצעת שיבוץ
            </Button>
          )}
        </div>

        <p className="text-[11px] text-slate-500">
          ניתן לפצל קבוצה בין שכונות ולשתף שכונה באישור; אוהל פיזי נשאר בלעדי בכל טווח תאריכים חופף.
        </p>
        {isMultiPeriod && canUseMultiPeriod && periodState !== 'past' && seriesValidation.valid === true && (
          <ScopedAutoAllocation key={selectedPeriod?.id || 'all'} groupId={groupId} selectedPeriod={selectedPeriod} hasLaterPeriods={selectedPeriod ? laterStayPeriods(sortedStayPeriods, selectedPeriod.id).some(p => p.end_date > todayLocal()) : false} tents={allTents} neighborhoods={neighborhoods} onSaved={invalidate} />
        )}

        {!isMultiPeriod && showSuggestion && suggestion.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" />
              הצעת שיבוץ אוטומטית — {totalTentsNeeded} אוהלים נדרשים
            </p>
            {suggestion.map(({ neighborhood, tents, use, spare }) => (
              <div key={neighborhood.id} className="text-xs text-amber-700 flex items-center gap-2">
                <span className="font-medium">{neighborhood.name}:</span>
                <span>השתמש ב-{use} מתוך {tents} אוהלים</span>
                {spare > 0 && <span className="text-amber-500 text-[10px]">({spare} פנויים חסומים מבלעדיות)</span>}
              </div>
            ))}
            <p className="text-[10px] text-amber-500">הצעה בלבד — ניתן לבחור שכונות אחרות</p>
          </div>
        )}

        {isMultiPeriod && !canUseMultiPeriod && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            שיבוץ אוהלים רב־תקופתי זמין לאחר אישור המכינה והפעלתה התפעולית.
          </div>
        )}
        {isMultiPeriod && seriesValidation.status === 'LOADING' && (
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            בודק את תקינות השיבוץ הרב־תקופתי…
          </div>
        )}
        {isMultiPeriod && seriesValidation.status === 'INVALID_SERIES' && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
            השיבוץ הרב־תקופתי הקיים אינו עקבי. נדרשת בדיקה לפני עריכה או אישור; אין לשחרר היסטוריה כדי לתקן אותו.
          </div>
        )}
        {isMultiPeriod && (
          <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            בתצוגת כל התקופות, תג תאריך ליד שכונה או אוהל מציין בדיוק באילו תקופות הם בשימוש.
            </div>
        )}

        {visibleStudentNeighborhoods.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">{isPeriodView ? "לא נמצאו שיבוצי חניכים בתקופה זו." : "לא נמצאו שכונות חניכים במלאי."}</p>
        )}

        {visibleStudentNeighborhoods.map(hood => {
          const hoodTents = allTents.filter(t => t.neighborhood_id === hood.id && t.working_status === "WORKING");
          return (
            <StudentNeighborhoodPanel
            key={hood.id}
            neighborhood={hood}
            tents={hoodTents}
            lockByThisGroup={myNhoodResById[hood.id] || null}
            lockByOtherGroup={otherNhoodResByNeighborhood[hood.id] || null}
            arrivalDate={arrivalDate}
            departureDate={departureDate}
            groupId={groupId}
            profileId={profile.id}
            onReserve={handleReserveNeighborhood}
            onRelease={handleReleaseNeighborhood}
            saving={saving}
            allConfirmedAllocs={allConfirmedAllocations}
            allActiveAllocs={allActiveAllocations}
            onSaved={invalidate}
            defaultGenderGroup={defaultGenderGroup}
            profile={profile}
            existingGroupAllocs={displayedAllocations}
            occupiedTents={tentConflictsByNeighborhood[hood.id] || []}
            isMultiPeriod={isMultiPeriod}
            canUseMultiPeriod={canUseMultiPeriod && !isPeriodView}
            logicalAssignments={displayedLogicalSeriesData.logical_assignments}
            seriesValidation={seriesValidation}
            activeStayPeriods={visibleStayPeriods}
            readOnly={isPeriodView}
            allowPeriodPaxEdit={isPeriodView && periodState !== "past"}
            onPeriodPaxEdit={setPeriodPaxTarget}
            allowPeriodLocationEdit={isPeriodView && periodState !== "past"}
            onPeriodLocationEdit={setPeriodLocationTarget}
            allowPeriodRelease={isPeriodView && periodState !== "past"}
            onPeriodRelease={setPeriodReleaseTarget}
            allowPeriodNeighborhoodRelease={isPeriodView && periodState !== "past" && displayedAllocations.some(row => row.neighborhood_id === hood.id && row.allocation_type === "STUDENT" && !/__(?:vip_req_\d+|alt_tent)__/i.test(row.notes || ""))}
            onPeriodNeighborhoodRelease={() => setPeriodNeighborhoodReleaseTarget({ neighborhood: hood, allocations: displayedAllocations.filter(row => row.neighborhood_id === hood.id && row.allocation_type === "STUDENT" && !/__(?:vip_req_\d+|alt_tent)__/i.test(row.notes || "")) })}
            temporalCoverage={!isPeriodView ? locationCoverage[hood.id] : null}
            />
          );
        })}
      </section>

      {/* ── VIP ALLOCATION ── */}
      {vipRows.length > 0 && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-slate-800">שיבוץ VIP</h3>{!isPeriodView && <TemporalScopeBadge scope={locationCoverage[vipNeighborhood?.id]?.scope} />}</div>
          <p className="text-[11px] text-slate-500">
            {isPeriodView ? "מצב שיבוצי ה-VIP בתקופה שנבחרה." : <>שייך כל דרישת VIP לאוהל ספציפי (80–89). לחץ על דרישה ← לאחר מכן על אוהל.{isMultiPeriod && " תג תאריך ליד אוהל מציין שימוש בחלק מהתקופות בלבד."}</>}
          </p>

          {isMultiPeriod && !canUseMultiPeriod && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              שיבוץ VIP רב־תקופתי זמין לאחר אישור המכינה והפעלתה התפעולית.
            </p>
          )}
          {!isMultiPeriod && !arrivalDate && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠️ תאריכי לינה לא הוגדרו — לא ניתן לבדוק זמינות.
            </p>
          )}

          <VipAllocationPanel
            vipRows={vipRows}
            vipTents={vipTents}
            vipNeighborhoodId={vipNeighborhood?.id}
            conflictMap={vipTentConflictMap}
            myAllocations={displayedAllocations}
            profile={{ ...profile, arrival_date: arrivalDate, departure_date: departureDate }}
            groupId={groupId}
            onInvalidate={invalidate}
            isMultiPeriod={isMultiPeriod}
            canUseMultiPeriod={canUseMultiPeriod && !isPeriodView && seriesValidation.status !== 'INVALID_SERIES'}
            logicalAssignments={displayedLogicalSeriesData.logical_assignments}
            group={group}
            readOnly={isPeriodView}
            allowPeriodPaxEdit={isPeriodView && periodState !== "past"}
            onPeriodPaxEdit={setPeriodPaxTarget}
            allowPeriodLocationEdit={isPeriodView && periodState !== "past"}
            onPeriodLocationEdit={setPeriodLocationTarget}
            allowPeriodRelease={isPeriodView && periodState !== "past"}
            onPeriodRelease={setPeriodReleaseTarget}
            allowPeriodAdd={isPeriodView && periodState !== "past"}
            onPeriodAdd={(requirement, index) => setPeriodAddTarget({ kind: "VIP", requirement, index })}
            tentTemporalScopes={!isPeriodView ? locationCoverage[vipNeighborhood?.id]?.tents : null}
          />
        </section>
      )}

      {!isMultiPeriod && vipRows.length === 0 && vipTents.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">שיבוץ VIP</h3>
          <p className="text-xs text-slate-400 italic">לא הוגדרו דרישות VIP לקבוצה זו.</p>
        </section>
      )}

      {/* ── ALT TENT ALLOCATION ── */}
      <AltTentAllocationPanel
        profile={{ ...profile, arrival_date: arrivalDate, departure_date: departureDate }}
        groupId={groupId}
        allTents={allTents}
        neighborhoods={neighborhoods}
        myAllocations={displayedAllocations}
        allActiveAllocations={allActiveAllocations}
        arrivalDate={arrivalDate}
        departureDate={departureDate}
        onInvalidate={invalidate}
        isMultiPeriod={isMultiPeriod}
        canUseMultiPeriod={canUseMultiPeriod && !isPeriodView && seriesValidation.status !== 'INVALID_SERIES'}
        logicalAssignments={displayedLogicalSeriesData.logical_assignments}
        activeStayPeriods={visibleStayPeriods}
        readOnly={isPeriodView}
      />

      {periodPaxTarget && selectedPeriod && (
        <RoleGate permission="MANAGE_ALLOCATION">
          <PeriodPaxEditDialog
            target={periodPaxTarget}
            groupId={groupId}
            hasLaterPeriods={laterStayPeriods(sortedStayPeriods, selectedPeriod.id).length > 0}
            onClose={() => setPeriodPaxTarget(null)}
            onSaved={() => { setPeriodPaxTarget(null); invalidate(); }}
          />
        </RoleGate>
      )}

      {periodLocationTarget && selectedPeriod && (
        <RoleGate permission="MANAGE_ALLOCATION">
          <PeriodTentReassignmentDialog
            target={periodLocationTarget}
            groupId={groupId}
            tents={allTents}
            hasLaterPeriods={laterStayPeriods(sortedStayPeriods, selectedPeriod.id).length > 0}
            onClose={() => setPeriodLocationTarget(null)}
            onSaved={() => { setPeriodLocationTarget(null); invalidate(); }}
          />
        </RoleGate>
      )}

      {periodReleaseTarget && selectedPeriod && (
        <RoleGate permission="MANAGE_ALLOCATION">
          <PeriodReleaseDialog target={periodReleaseTarget} groupId={groupId} hasLaterPeriods={laterStayPeriods(sortedStayPeriods, selectedPeriod.id).length > 0} onClose={() => setPeriodReleaseTarget(null)} onSaved={() => { setPeriodReleaseTarget(null); invalidate(); }} />
        </RoleGate>
      )}

      {periodNeighborhoodReleaseTarget && selectedPeriod && (
        <RoleGate permission="MANAGE_ALLOCATION">
          <PeriodNeighborhoodReleaseDialog target={periodNeighborhoodReleaseTarget} groupId={groupId} selectedPeriodId={selectedPeriod.id} hasLaterPeriods={laterStayPeriods(sortedStayPeriods, selectedPeriod.id).length > 0} onClose={() => setPeriodNeighborhoodReleaseTarget(null)} onSaved={() => { setPeriodNeighborhoodReleaseTarget(null); invalidate(); }} />
        </RoleGate>
      )}

      {periodAddTarget && selectedPeriod && (
        <RoleGate permission="MANAGE_ALLOCATION">
          <PeriodAddAllocationDialog
            kind={periodAddTarget.kind}
            vipRequirement={periodAddTarget.requirement}
            requirementIndex={periodAddTarget.index}
            groupId={groupId}
            selectedPeriodId={selectedPeriod.id}
            tents={allTents}
            neighborhoods={neighborhoods}
            hasLaterPeriods={laterStayPeriods(sortedStayPeriods, selectedPeriod.id).length > 0}
            defaultPax={Math.max(1, (Number(profile.boys_beds_needed ?? profile.boys_count ?? 0) + Number(profile.girls_beds_needed ?? profile.girls_count ?? 0)) - displayedAllocations.filter(row => row.allocation_type === "STUDENT").reduce((sum, row) => sum + Number(row.allocated_pax || 0), 0))}
            requiredPax={periodAddTarget.kind === "VIP" ? vipRows.reduce((sum, row) => sum + Number(row.people_count || 0), 0) : Number(profile.boys_beds_needed ?? profile.boys_count ?? 0) + Number(profile.girls_beds_needed ?? profile.girls_count ?? 0)}
            allocatedPax={displayedAllocations.filter(row => row.allocation_type === (periodAddTarget.kind === "VIP" ? "STAFF" : "STUDENT")).reduce((sum, row) => sum + Number(row.allocated_pax || 0), 0)}
            defaultGender={defaultGenderGroup}
            onClose={() => setPeriodAddTarget(null)}
            onSaved={() => { setPeriodAddTarget(null); invalidate(); }}
          />
        </RoleGate>
      )}

      {/* ── CONFIRMATION PANEL ── */}
      {!isPeriodView && (() => {
        const physicalDraftAllocs = myAllocations.filter(a => a.status === "DRAFT");
        const physicalConfirmedAllocs = myAllocations.filter(a => a.status === "CONFIRMED");
        const activeAllocs = myAllocations.filter(a => a.status !== "CANCELLED");
        const logicalAllocs = logicalSeriesData.logical_assignments.filter(a => !a.inconsistent);
        const draftAllocs = isMultiPeriod ? logicalAllocs.filter(a => a.has_draft) : physicalDraftAllocs;
        const confirmedAllocs = isMultiPeriod ? logicalAllocs.filter(a => a.all_confirmed) : physicalConfirmedAllocs;
        const totalAssigned = isMultiPeriod
          ? logicalAllocs.reduce((s, a) => s + (a.logical_allocated_pax || 0), 0)
          : activeAllocs.reduce((s, a) => s + (a.allocated_pax || 0), 0);
        const tentCount = isMultiPeriod ? logicalAllocs.length : new Set(activeAllocs.map(a => a.tent_id)).size;
        const hasNhoodOnly = myActiveNhoodRes.length > 0 && activeAllocs.length === 0;

        // Unified counts for partial allocation warning
        const unifiedCounts = computeAllocationCounts(isMultiPeriod ? actionableSleepingRows(myAllocations) : myAllocations, profile);
        const isPartialAlloc = unifiedCounts.totalRequired > 0 && unifiedCounts.totalRemaining > 0;

        // A: All specific tents confirmed
        if (confirmedAllocs.length > 0 && draftAllocs.length === 0) {
          return (
            <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
              isPartialAlloc || seriesValidation.status === 'MISSING_COVERAGE'
                ? "bg-amber-50 border border-amber-300"
                : "bg-emerald-50 border border-emerald-300"
            }`}>
              {isPartialAlloc || seriesValidation.status === 'MISSING_COVERAGE' ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              )}
              <div className="flex-1">
                <p className={`text-sm font-semibold ${isPartialAlloc || seriesValidation.status === 'MISSING_COVERAGE' ? "text-amber-800" : "text-emerald-800"}`}>
                  {seriesValidation.status === 'MISSING_COVERAGE' ? 'לינה ממתינה לשיבוץ' : isPartialAlloc ? "שיבוץ חלקי — מאושר" : "שיבוץ לפי אוהלים — מאושר"}
                </p>
                <p className={`text-xs ${isPartialAlloc || seriesValidation.status === 'MISSING_COVERAGE' ? "text-amber-700" : "text-emerald-600"}`}>
                  {totalAssigned} משתתפים · {tentCount} אוהלים{isMultiPeriod ? ` · ${physicalConfirmedAllocs.length} שורות תקופתיות מאושרות` : ` · ${confirmedAllocs.length} שורות מאושרות`}
                </p>
                {isPartialAlloc && (
                  <p className="text-xs text-amber-700 font-medium mt-0.5">
                    נותרו {unifiedCounts.totalRemaining} אנשים ללא שיבוץ
                  </p>
                )}
              </div>
            </div>
          );
        }

        // B: Specific tent DRAFT rows — needs confirmation
        if (draftAllocs.length > 0) {
          const nhoodNames = [...new Set(
            draftAllocs.map(a => neighborhoods.find(n => n.id === a.neighborhood_id)?.name || a.neighborhood_id)
          )].join(", ");
          return (
            <div className="border border-amber-300 bg-amber-50 rounded-xl px-4 py-4 space-y-3">
              <div className="flex items-start gap-2">
                <Shield className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">שיבוץ לפי אוהלים — טיוטה</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {isMultiPeriod ? `${draftAllocs.length} שיבוצים לוגיים (${physicalDraftAllocs.length} שורות תקופתיות)` : `${draftAllocs.length} שורות טיוטה`} · {totalAssigned} משתתפים · {tentCount} אוהלים
                    {nhoodNames && <span> · שכונות: {nhoodNames}</span>}
                  </p>
                  {confirmedAllocs.length > 0 && (
                    <p className="text-xs text-emerald-700 mt-0.5">{confirmedAllocs.length} {isMultiPeriod ? "שיבוצים לוגיים כבר מאושרים" : "שורות כבר מאושרות"}</p>
                  )}
                </div>
              </div>

              {/* Partial allocation warning (soft — not blocking) */}
              {isPartialAlloc && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-100/60 border border-amber-300 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">שיבוץ חלקי — נותרו {unifiedCounts.totalRemaining} אנשים ללא שיבוץ</p>
                    <p className="text-[11px] mt-0.5">
                      סה״כ נדרש: {unifiedCounts.totalRequired} · שובץ: {unifiedCounts.totalAllocated} · נותרו: {unifiedCounts.totalRemaining}
                    </p>
                    {unifiedCounts.vipAllocated > 0 && <span className="text-[10px]">VIP: {unifiedCounts.vipAllocated} · </span>}
                    {unifiedCounts.altTentAllocated > 0 && <span className="text-[10px]">אוהל חילופי: {unifiedCounts.altTentAllocated} · </span>}
                    {unifiedCounts.studentAllocated > 0 && <span className="text-[10px]">חניכים: {unifiedCounts.studentAllocated}</span>}
                  </div>
                </div>
              )}

              {/* Shared neighborhood override — shown when backend returns needs_shared_override */}
              {pendingSharedOverride && (
                <div className="border border-amber-400 bg-amber-50 rounded-xl px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    שכונה משותפת נדרשת: {pendingSharedOverride.blockedNeighborhoods.join(", ")}
                  </p>
                  {pendingSharedOverride.errors.map((e, i) => (
                    <p key={i} className="text-xs text-amber-700">• {e}</p>
                  ))}
                  <p className="text-[11px] text-amber-700">
                    כדי לאשר, הזן סיבה לשימוש משותף בשכונה. אוהלים כפולים לא יאושרו בכל מקרה.
                  </p>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-amber-800">סיבת אישור שכונה משותפת *</label>
                    <textarea
                      className="w-full text-xs rounded-lg border border-amber-300 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 min-h-[52px] resize-none"
                      value={sharedOverrideReason}
                      onChange={e => setSharedOverrideReason(e.target.value)}
                      placeholder="לדוגמה: הקבוצות משתמשות באוהלים שונים בלבד / אושר מול התפעול"
                    />
                    {!sharedOverrideReason.trim() && (
                      <p className="text-[10px] text-red-600">סיבה חובה</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-slate-300"
                      onClick={() => { setPendingSharedOverride(null); setSharedOverrideReason(""); }}
                    >
                      ביטול
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white flex-1"
                      onClick={() => handleConfirmAllocations({ sharedAllowed: true, sharedReason: sharedOverrideReason })}
                      disabled={saving || !sharedOverrideReason.trim()}
                    >
                      <Users className="w-3.5 h-3.5" />
                      {saving ? "מאשר..." : "אשר עם שכונה משותפת"}
                    </Button>
                  </div>
                </div>
              )}

              {!pendingSharedOverride && (
                <RoleGate permission="CONFIRM_ALLOCATION">
                  <Button
                    className={`w-full gap-2 text-white ${
                      isPartialAlloc
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-emerald-700 hover:bg-emerald-800"
                    }`}
                    onClick={() => handleConfirmAllocations()}
                    disabled={saving || (isMultiPeriod && seriesValidation.valid === false)}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {saving ? "מאשר..." : isPartialAlloc ? "אשר שיבוץ חלקי" : "אשר שיבוץ לינה"}
                  </Button>
                </RoleGate>
              )}
            </div>
          );
        }

        // C: Neighborhood-only reservation (no specific tent rows yet)
        if (hasNhoodOnly) {
          const nhoodNames = myActiveNhoodRes
            .map(r => neighborhoods.find(n => n.id === r.neighborhood_id)?.name || r.neighborhood_id)
            .join(", ");
          return (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-300 rounded-xl px-4 py-3">
              <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-800">שיבוץ אזורי נשמר</p>
                <p className="text-xs text-blue-600">
                  {nhoodNames && <span>שכונות: {nhoodNames} · </span>}
                  טרם בוצע פירוט לפי אוהלים ספציפיים
                </p>
                <p className="text-[11px] text-blue-500 mt-0.5">לפירוט מלא לחץ "פירוט לפי אוהלים" על השכונה הרלוונטית</p>
              </div>
            </div>
          );
        }

        return null;
      })()}

    </div>
  );
}