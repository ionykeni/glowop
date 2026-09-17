import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Save, Unlock } from "lucide-react";
import { toast } from "sonner";
import { releaseSleepingSeries, actionableSleepingRows } from '@/components/sleeping/seriesActions';
import { groupLogicalSleepingAssignments } from '@/components/sleeping/logicalSleepingView';
import { sortTentsNaturally } from './tentCodeSort';

const GENDER_LABEL = { BOYS: "בנים 👦", GIRLS: "בנות 👧", MEN: "גברים 👨", WOMEN: "נשים 👩" };

// For MIXED neighborhoods, each tent must be assigned to BOYS or GIRLS
const STUDENT_GENDER_OPTIONS = [
  { value: "BOYS",  label: "בנים" },
  { value: "GIRLS", label: "בנות" },
];

/**
 * Props:
 *  open                  - boolean
 *  onClose               - () => void
 *  neighborhood          - Neighborhood record
 *  tents                 - Tent[] (working tents in this neighborhood)
 *  reservation           - NeighborhoodReservation (the lock)
 *  groupId               - string
 *  profileId             - string
 *  arrivalDate           - string
 *  departureDate         - string
 *  allConfirmedAllocs    - SleepingAllocation[] from ALL groups (for overbooking check)
 *  onSaved               - () => void  (invalidate parent)
 */
export default function TentDistributionEditor({
  open,
  onClose,
  neighborhood,
  tents = [],
  reservation,
  groupId,
  profileId,
  profile = null,
  arrivalDate,
  departureDate,
  allConfirmedAllocs = [],
  allActiveAllocs = [],
  onSaved,
  isMultiPeriod = false,
  canUseMultiPeriod = false,
  seriesValidation = null,
  activeStayPeriods = [],
  sharedNeighborhoods = [],
}) {
  const queryClient = useQueryClient();

  // Fetch existing allocations for this group in this neighborhood
  // staleTime: 0 — always refetch when the dialog opens so pax/conflict state is current
  const { data: existingAllocs = [] } = useQuery({
    queryKey: ["sleepingAllocations", groupId],
    queryFn: () => base44.entities.SleepingAllocation.filter({ group_id: groupId }),
    enabled: !!groupId && open,
    staleTime: 0,
  });

  // paxMap: tentId → pax string
  const [paxMap, setPaxMap] = useState({});
  // notesMap: tentId → notes string
  const [notesMap, setNotesMap] = useState({});
  // genderMap: tentId → "BOYS" | "GIRLS" (used when reservation is MIXED)
  const [genderMap, setGenderMap] = useState({});
  const [saving, setSaving] = useState(false);
  const [releasingTentId, setReleasingTentId] = useState(null);
  const [overrideMismatch, setOverrideMismatch] = useState(false);
  const [periodErrors, setPeriodErrors] = useState([]);
  const [liveTrace, setLiveTrace] = useState(null);

  // A preview error belongs only to the exact draft that produced it.
  const draftSignature = useMemo(() => JSON.stringify({
    open: !!open,
    neighborhood_id: neighborhood?.id || null,
    reservation_id: reservation?.id || null,
    reservation_gender_group: reservation?.gender_group || null,
    pax: Object.entries(paxMap).sort(([a], [b]) => a.localeCompare(b)),
    genders: Object.entries(genderMap).sort(([a], [b]) => a.localeCompare(b)),
    notes: Object.entries(notesMap).sort(([a], [b]) => a.localeCompare(b)),
    active_periods: activeStayPeriods.map(period => ({
      id: period.id,
      start_date: period.start_date,
      end_date: period.end_date,
      status: period.status,
    })),
    shared_neighborhoods: sharedNeighborhoods.map(item => ({
      neighborhood_id: item.neighborhood_id,
      shared_neighborhood_allowed: item.shared_neighborhood_allowed,
      reason: item.reason,
    })),
  }), [
    open,
    neighborhood?.id,
    reservation?.id,
    reservation?.gender_group,
    paxMap,
    genderMap,
    notesMap,
    activeStayPeriods,
    sharedNeighborhoods,
  ]);

  useEffect(() => {
    if (open) {
      setPeriodErrors([]);
      setLiveTrace(null);
    }
  }, [open, draftSignature]);

  // Active student allocs for this group in this neighborhood
  const myNeighborhoodAllocs = useMemo(
    () => existingAllocs.filter(
      a => a.neighborhood_id === neighborhood?.id &&
           a.status !== "CANCELLED" &&
           a.allocation_type === "STUDENT"
    ),
    [existingAllocs, neighborhood]
  );
  const logicalAssignments = useMemo(
    () => groupLogicalSleepingAssignments(
      isMultiPeriod ? actionableSleepingRows(existingAllocs) : existingAllocs.filter(a => a.status !== "CANCELLED")
    ).logical_assignments,
    [existingAllocs, isMultiPeriod]
  );
  const logicalStudentAssignments = useMemo(
    () => logicalAssignments.filter(a => a.allocation_type === "STUDENT"),
    [logicalAssignments]
  );
  const displayedNeighborhoodAllocs = useMemo(
    () => isMultiPeriod
      ? logicalStudentAssignments.filter(a => a.neighborhood_id === neighborhood?.id)
      : myNeighborhoodAllocs,
    [isMultiPeriod, logicalStudentAssignments, myNeighborhoodAllocs, neighborhood]
  );

  const isMixedReservation = reservation?.gender_group === "MIXED";

  // Initialise paxMap / notesMap / genderMap from existing allocations when opening
  useEffect(() => {
    if (!open) return;
    const pm = {};
    const nm = {};
    const gm = {};
    displayedNeighborhoodAllocs.forEach(a => {
      const pax = isMultiPeriod ? a.logical_allocated_pax : a.allocated_pax;
      pm[a.tent_id] = String(pax ?? 0);
      nm[a.tent_id] = a.notes || "";
      // Preserve existing gender; default to BOYS for new entries in mixed
      gm[a.tent_id] = (a.gender_group === "BOYS" || a.gender_group === "GIRLS") ? a.gender_group : "BOYS";
    });
    setPaxMap(pm);
    setNotesMap(nm);
    setGenderMap(gm);
    setOverrideMismatch(false);
    setPeriodErrors([]);
  }, [open, displayedNeighborhoodAllocs, isMultiPeriod]);

  // Exact tent availability remains authoritative even when neighborhood sharing is approved.
  const tentConflictMap = useMemo(() => {
    const map = {};
    const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
    const source = isMultiPeriod ? allActiveAllocs : allConfirmedAllocs;
    source.forEach(allocation => {
      if (allocation.group_id === groupId || allocation.status === "CANCELLED") return;
      if (allocation.departure_date <= todayIL) return;
      const conflictingPeriods = isMultiPeriod
        ? activeStayPeriods.filter(period => period.end_date > todayIL && period.start_date < allocation.departure_date && allocation.arrival_date < period.end_date)
        : (arrivalDate && departureDate && arrivalDate < allocation.departure_date && allocation.arrival_date < departureDate
          ? [{ start_date: arrivalDate, end_date: departureDate }]
          : []);
      if (conflictingPeriods.length === 0) return;
      (map[allocation.tent_id] ||= []).push({
        arrival_date: allocation.arrival_date,
        departure_date: allocation.departure_date,
        required_periods: conflictingPeriods.map(period => ({ start_date: period.start_date, end_date: period.end_date })),
      });
    });
    return map;
  }, [isMultiPeriod, allActiveAllocs, allConfirmedAllocs, groupId, activeStayPeriods, arrivalDate, departureDate]);
  const overbookedTentIds = useMemo(() => new Set(Object.keys(tentConflictMap)), [tentConflictMap]);

  const totalAssigned = useMemo(
    () => tents.reduce((s, t) => s + (Number(paxMap[t.id]) || 0), 0),
    [tents, paxMap]
  );

  const requiredSleepingPax = (Number(profile?.boys_beds_needed ?? profile?.boys_count ?? 0) || 0) +
    (Number(profile?.girls_beds_needed ?? profile?.girls_count ?? 0) || 0) +
    (Number(profile?.staff_count ?? 0) || 0);
  const otherLogicalPax = logicalAssignments
    .filter(a => !a.inconsistent && (a.allocation_type !== "STUDENT" || a.neighborhood_id !== neighborhood?.id))
    .reduce((sum, assignment) => sum + (Number(assignment.logical_allocated_pax) || 0), 0);
  const intendedTotalPax = otherLogicalPax + totalAssigned;
  const isOverRequirement = requiredSleepingPax > 0 && intendedTotalPax > requiredSleepingPax;

  const invalidPaxErrors = useMemo(() => tents.flatMap(t => {
    const raw = paxMap[t.id];
    if (raw == null || raw === "") return [];
    const pax = Number(raw);
    return !Number.isFinite(pax) || pax < 0 ? [`אוהל ${t.code}: מספר האנשים חייב להיות אפס או מספר חיובי`] : [];
  }), [tents, paxMap]);

  // Capacity violations
  const capacityErrors = useMemo(() => {
    const errors = [];
    tents.forEach(t => {
      const pax = Number(paxMap[t.id]) || 0;
      if (pax > (t.capacity || 0)) {
        errors.push(`אוהל ${t.code}: כמות האנשים (${pax}) גבוהה מהקיבולת (${t.capacity})`);
      }
    });
    return errors;
  }, [tents, paxMap]);

  // Overbooking errors for tents we're assigning to
  const overbookingErrors = useMemo(() => {
    const errors = [];
    tents.forEach(t => {
      const pax = Number(paxMap[t.id]) || 0;
      if (pax > 0 && overbookedTentIds.has(t.id)) {
        errors.push(`אוהל ${t.code}: האוהל כבר משובץ לקבוצה אחרת בתאריכים אלו`);
      }
    });
    return errors;
  }, [tents, paxMap, overbookedTentIds]);

  const hasBlockingErrors = invalidPaxErrors.length > 0 || capacityErrors.length > 0 || overbookingErrors.length > 0 ||
    (isMultiPeriod && (!canUseMultiPeriod || seriesValidation?.valid === false));

  const formatPreviewConflict = (preview) => {
    const tentById = Object.fromEntries(tents.map(t => [t.id, t]));
    const exact = preview?.exact_tent_conflicts?.[0];
    if (exact) {
      const code = tentById[exact.tent_id]?.code || exact.tent_id;
      return `אוהל ${code} תפוס בתאריכים ${exact.planned_period.arrival_date}–${exact.planned_period.departure_date} על ידי קבוצה ${exact.conflicting_group_id}`;
    }
    const hood = preview?.neighborhood_conflicts?.find(c => c.blocked);
    if (hood) return `השכונה תפוסה בתאריכים ${hood.planned_period.arrival_date}–${hood.planned_period.departure_date} על ידי קבוצה ${hood.conflicting_group_id}`;
    return "לא ניתן לשמור את תכנית הלינה בגלל התנגשות.";
  };

  const handleSave = async () => {
    if (hasBlockingErrors) return;
    const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
    const removesActiveConfirmed = myNeighborhoodAllocs.some(a => a.status === "CONFIRMED" && a.arrival_date <= todayIL && a.departure_date > todayIL && !(Number(paxMap[a.tent_id]) > 0));
    if (!isMultiPeriod && removesActiveConfirmed) {
      toast.error("שינוי מקום של שיבוץ מאושר פעיל מחייב בחירה ב׳שנה החל מתאריך׳.");
      return;
    }

    // Check mismatch — warn but allow override
    // (we don't enforce exact match, just warn)

    setSaving(true);
    setPeriodErrors([]);
    setLiveTrace(null);
    let traceBase = null;
    let previewTrace = null;
    let commitEndpoint = null;
    try {
      if (isMultiPeriod) {
        if (!canUseMultiPeriod) throw new Error("שיבוץ רב־תקופתי זמין רק למכינה מאושרת ופעילה תפעולית.");
        if (seriesValidation?.valid === false) throw new Error("השיבוץ הקיים אינו עקבי. נדרשת בדיקה לפני שמירה.");

        const currentNeighborhoodAssignments = tents.flatMap(tent => {
          const pax = Number(paxMap[tent.id]) || 0;
          if (pax <= 0) return [];
          return [{
            allocation_series_id: displayedNeighborhoodAllocs.find(a => a.tent_id === tent.id)?.allocation_series_id,
            tent_id: tent.id,
            neighborhood_id: neighborhood.id,
            allocated_pax: pax,
            allocation_type: "STUDENT",
            gender_group: isMixedReservation ? (genderMap[tent.id] || "BOYS") : (reservation?.gender_group || "MIXED"),
            notes: notesMap[tent.id] || "",
          }];
        });
        const otherNeighborhoodAssignments = logicalAssignments
          .filter(a => !a.inconsistent && (a.allocation_type !== "STUDENT" || a.neighborhood_id !== neighborhood.id))
          .map(a => ({
            allocation_series_id: a.allocation_series_id,
            tent_id: a.tent_id,
            neighborhood_id: a.neighborhood_id,
            allocated_pax: a.logical_allocated_pax,
            allocation_type: a.allocation_type,
            gender_group: a.gender_group,
            notes: a.notes || "",
          }));
        const assignments = [...otherNeighborhoodAssignments, ...currentNeighborhoodAssignments];
        const editedAssignment = currentNeighborhoodAssignments.find(assignment => {
          const existing = displayedNeighborhoodAllocs.find(item => item.tent_id === assignment.tent_id);
          return Number(existing?.logical_allocated_pax) !== Number(assignment.allocated_pax);
        }) || currentNeighborhoodAssignments[0] || null;
        traceBase = {
          marker: "MP LIVE TRACE 2026-09-14-B",
          series_validation_status: seriesValidation?.status || (seriesValidation?.valid === false ? "INVALID" : seriesValidation?.valid === true ? "VALID" : "LOADING"),
          preview_endpoint: "previewMultiPeriodSleepingPlanCurrent",
          edited_assignment: editedAssignment,
          assignments_count: assignments.length,
        };

        const previewRes = await base44.functions.invoke("previewMultiPeriodSleepingPlanCurrent", {
          group_id: groupId,
          assignments,
          shared_neighborhoods: sharedNeighborhoods,
        });
        const preview = previewRes.data;
        previewTrace = {
          success: preview?.success ?? null,
          allowed: preview?.allowed ?? null,
          error: preview?.error ?? null,
          runtime_build: preview?.runtime_build ?? null,
          exact_tent_conflicts_count: preview?.exact_tent_conflicts?.length ?? 0,
          neighborhood_conflicts_count: preview?.neighborhood_conflicts?.length ?? 0,
        };

        if (!preview?.success || preview.legacy_envelope_requires_conversion || !preview.allowed) {
          const message = preview?.legacy_envelope_requires_conversion
            ? "קיים שיבוץ מעטפת ישן הדורש המרה לפני שמירה."
            : (preview?.error || formatPreviewConflict(preview));
          setPeriodErrors([message]);
          setLiveTrace({ ...traceBase, preview_response: previewTrace, commit_endpoint: null, commit_response: null });

          return;
        }
        setPeriodErrors([]);
        commitEndpoint = "commitMultiPeriodSleepingPlanCurrent";
        const commitRes = await base44.functions.invoke("commitMultiPeriodSleepingPlanCurrent", {
          group_id: groupId,
          assignments,
          shared_neighborhoods: sharedNeighborhoods,
        });
        if (!commitRes.data?.success) {
          const message = commitRes.data?.error === "INCONSISTENT_PERIODIZED_SLEEPING_STATE"
            ? "השיבוץ הקיים אינו תואם לתכנית. יש לרענן ולבדוק לפני שמירה."
            : (commitRes.data?.error || "שמירת התכנית הרב־תקופתית נכשלה");
          setPeriodErrors([message]);
          setLiveTrace({
            ...traceBase,
            preview_response: previewTrace,
            commit_endpoint: commitEndpoint,
            commit_response: {
              success: commitRes.data?.success ?? null,
              error: commitRes.data?.error ?? null,
              runtime_build: commitRes.data?.runtime_build ?? null,
              already_committed: commitRes.data?.already_committed ?? null,
              pax_edit: commitRes.data?.pax_edit ?? null,
              sleeping_rows_created: commitRes.data?.sleeping_rows_created ?? null,
              sleeping_rows_updated: commitRes.data?.sleeping_rows_updated ?? null,
            },
          });

          return;
        }

        toast.success(commitRes.data.already_committed
          ? "השיבוץ הרב־תקופתי כבר שמור ✓"
          : commitRes.data.pax_edit
            ? `עודכנו ${commitRes.data.sleeping_rows_updated} שורות בתקופות הפעילות והעתידיות ✓`
            : `נוצרו ${commitRes.data.sleeping_rows_created} שורות תקופתיות כשיבוץ לוגי אחד לכל אוהל ✓`);
        queryClient.invalidateQueries({ queryKey: ["sleepingAllocations", groupId] });
        onSaved?.();
        onClose();
        return;
      }

      // Build existing alloc map by tentId
      const existingByTent = {};
      myNeighborhoodAllocs.forEach(a => { existingByTent[a.tent_id] = a; });

      const ops = [];

      for (const tent of tents) {
        const pax = Number(paxMap[tent.id]) || 0;
        const existing = existingByTent[tent.id];
        const notes = notesMap[tent.id] || "";

        if (pax > 0) {
          // For MIXED neighborhoods: use per-tent gender selection; otherwise use reservation gender
          const tentGender = isMixedReservation
            ? (genderMap[tent.id] || "BOYS")
            : (reservation?.gender_group || "MIXED");
          const payload = {
            group_id: groupId,
            operational_group_profile_id: profileId,
            tent_id: tent.id,
            neighborhood_id: neighborhood.id,
            arrival_date: arrivalDate,
            departure_date: departureDate,
            allocated_pax: pax,
            allocation_type: "STUDENT",
            gender_group: tentGender,
            status: "DRAFT",
            notes,
          };
          if (existing) {
            ops.push(base44.entities.SleepingAllocation.update(existing.id, payload));
          } else {
            ops.push(base44.entities.SleepingAllocation.create(payload));
          }
        } else {
          // pax = 0 → cancel/delete existing
          if (existing) {
            if (existing.status === "DRAFT") {
              ops.push(base44.entities.SleepingAllocation.delete(existing.id));
            } else {
              ops.push(base44.entities.SleepingAllocation.update(existing.id, { status: "CANCELLED" }));
            }
          }
        }
      }

      await Promise.all(ops);

      queryClient.invalidateQueries({ queryKey: ["sleepingAllocations", groupId] });
      queryClient.invalidateQueries({ queryKey: ["allConfirmedAllocations"] });
      toast.success("חלוקת האוהלים נשמרה ✓");
      onSaved?.();
      onClose();
    } catch (err) {
      console.error("[TentDistributionEditor] save error:", err);
      if (isMultiPeriod) {
        const catchDetail = err?.response?.data || err?.message || String(err);
        const catchMessage = catchDetail?.error || catchDetail?.message || err?.message || "שגיאה בשמירה — נסה שוב";
        setPeriodErrors([catchMessage]);
        setLiveTrace({
          ...(traceBase || {
            marker: "MP LIVE TRACE 2026-09-14-B",
            series_validation_status: seriesValidation?.status || (seriesValidation?.valid === false ? "INVALID" : seriesValidation?.valid === true ? "VALID" : "LOADING"),
            preview_endpoint: "previewMultiPeriodSleepingPlanCurrent",
            edited_assignment: null,
            assignments_count: null,
          }),
          preview_response: previewTrace || {
            success: null,
            allowed: null,
            error: commitEndpoint ? null : catchMessage,
            exact_tent_conflicts_count: 0,
            neighborhood_conflicts_count: 0,
          },
          commit_endpoint: commitEndpoint,
          commit_response: commitEndpoint ? {
            success: false,
            error: catchMessage,
            runtime_build: catchDetail?.runtime_build ?? null,
            already_committed: null,
            pax_edit: null,
            sleeping_rows_created: null,
            sleeping_rows_updated: null,
          } : null,
        });

      } else {
        toast.error(err?.message || "שגיאה בשמירה — נסה שוב");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReleaseTent = async (tent) => {
    if (isMultiPeriod) {
      const assignment = displayedNeighborhoodAllocs.find(a => a.tent_id === tent.id);
      if (!window.confirm(`לשחרר רק את השיבוץ הנוכחי והעתידי של אוהל ${tent.code}? ההיסטוריה תישמר.`)) return;
      setReleasingTentId(tent.id);
      try {
        await releaseSleepingSeries(groupId, assignment?.allocation_series_id);
        queryClient.invalidateQueries({ queryKey: ['sleepingAllocations', groupId] });
        onSaved?.();
        onClose();
        toast.success('השיבוץ שוחרר; יתר האוהלים וההיסטוריה נשמרו');
      } catch (err) { setPeriodErrors([err.message]); }
      finally { setReleasingTentId(null); }
      return;
    }
    const existing = myNeighborhoodAllocs.find(a => a.tent_id === tent.id);
    if (!existing) return;
    const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
    if (existing.status === "CONFIRMED" && existing.arrival_date <= todayIL && existing.departure_date > todayIL) {
      toast.error("שינוי מקום של שיבוץ מאושר פעיל מחייב בחירה ב׳שנה החל מתאריך׳.");
      return;
    }
    if (!window.confirm(`לשחרר את אוהל ${tent.code}?`)) return;
    setReleasingTentId(tent.id);
    try {
      if (existing.status === "DRAFT") {
        await base44.entities.SleepingAllocation.delete(existing.id);
      } else {
        await base44.entities.SleepingAllocation.update(existing.id, { status: "CANCELLED" });
      }
      setPaxMap(p => ({ ...p, [tent.id]: "0" }));
      queryClient.invalidateQueries({ queryKey: ["sleepingAllocations", groupId] });
      queryClient.invalidateQueries({ queryKey: ["allConfirmedAllocations"] });
      toast.success(`אוהל ${tent.code} שוחרר`);
      onSaved?.();
    } catch (err) {
      toast.error(err?.message || "שגיאה בשחרור — נסה שוב");
    } finally {
      setReleasingTentId(null);
    }
  };

  const sortedTents = sortTentsNaturally(tents);

  if (!neighborhood) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            חלוקה לאוהלים ספציפיים — {neighborhood.name}
          </DialogTitle>
          {reservation && (
            <p className="text-xs text-slate-500 mt-0.5">
              {GENDER_LABEL[reservation.gender_group] ?? reservation.gender_group}
              {" · "}
              {isMultiPeriod ? "כל תקופות השהייה הפעילות" : `${arrivalDate} → ${departureDate}`}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-2 my-2">
          {/* Column headers */}
          {isMixedReservation && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-1">
              שכונה מעורבת — יש לבחור בנים/בנות לכל אוהל
            </div>
          )}
          <div className={`grid gap-2 text-[10px] font-semibold text-slate-400 uppercase px-1 ${isMixedReservation ? "grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto_auto_auto]"}`}>
            <span>אוהל</span>
            <span className="w-14 text-center">קיבולת</span>
            {isMixedReservation && <span className="w-20 text-center">מגדר</span>}
            <span className="w-20 text-center">מספר אנשים</span>
            <span className="w-28">הערות</span>
            <span className="w-16"></span>
          </div>

          {sortedTents.map(tent => {
            const pax = Number(paxMap[tent.id]) || 0;
            const isOverBooked = overbookedTentIds.has(tent.id);
            const exactConflicts = tentConflictMap[tent.id] || [];
            const isOverCap = pax > (tent.capacity || 0);
            const hasExistingAlloc = !!displayedNeighborhoodAllocs.find(a => a.tent_id === tent.id);
            const isReleasingThis = releasingTentId === tent.id;
            const rowBg = isOverBooked
              ? "bg-red-50 border-red-200"
              : isOverCap
              ? "bg-amber-50 border-amber-200"
              : pax > 0
              ? "bg-emerald-50 border-emerald-200"
              : "bg-white border-slate-300";

            return (
              <div key={tent.id} className={`grid items-center gap-2 rounded-lg border px-3 py-2 shadow-sm ${isMixedReservation ? "grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto_auto_auto]"} ${rowBg}`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-sm text-slate-800">{tent.code}</span>
                  {isOverBooked ? (
                    <span className="text-[10px] text-red-600 font-medium">
                      לא זמין · {exactConflicts[0].arrival_date}–{exactConflicts[0].departure_date}
                    </span>
                  ) : isMultiPeriod ? (
                    <span className="text-[10px] text-emerald-600 font-medium">זמין בכל התקופות</span>
                  ) : null}
                </div>
                <span className="w-14 text-center text-xs text-slate-500">{tent.capacity || "—"}</span>
                {isMixedReservation && (
                  <Select
                    value={genderMap[tent.id] || "BOYS"}
                    onValueChange={v => setGenderMap(g => ({ ...g, [tent.id]: v }))}
                    disabled={Number(paxMap[tent.id]) === 0}
                  >
                    <SelectTrigger className="w-20 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STUDENT_GENDER_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  type="number"
                  min="0"
                  max={tent.capacity || 999}
                  value={paxMap[tent.id] ?? "0"}
                  onChange={e => {
                    const val = e.target.value;
                    setPaxMap(p => ({ ...p, [tent.id]: val }));
                    // Auto-enable gender selector when pax > 0
                    if (isMixedReservation && Number(val) > 0 && !genderMap[tent.id]) {
                      setGenderMap(g => ({ ...g, [tent.id]: "BOYS" }));
                    }
                  }}
                  className="w-20 h-7 text-xs text-center"
                  disabled={isOverBooked && !hasExistingAlloc}
                />
                <Input
                  value={notesMap[tent.id] ?? ""}
                  onChange={e => setNotesMap(n => ({ ...n, [tent.id]: e.target.value }))}
                  placeholder="הערות..."
                  className="w-28 h-7 text-xs"
                  disabled={isOverBooked && !hasExistingAlloc}
                />
                <div className="w-16 flex justify-center">
                  {hasExistingAlloc && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isReleasingThis || saving}
                      onClick={() => handleReleaseTent(tent)}
                      className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50 px-2"
                    >
                      <Unlock className="w-3 h-3" />
                      {isReleasingThis ? "..." : "שחרר"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm">
          <span className="text-slate-600">סה״כ שובץ:</span>
          <span className={`font-bold text-base ${totalAssigned === 0 ? "text-slate-400" : "text-slate-800"}`}>
            {totalAssigned} אנשים
          </span>
        </div>

        {isOverRequirement && (
          <div className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            שובצו יותר מקומות לינה מהדרישה הנוכחית — נדרש: {requiredSleepingPax}, שובץ: {intendedTotalPax}
          </div>
        )}

        {/* Validation errors */}
        {(invalidPaxErrors.length > 0 || capacityErrors.length > 0 || overbookingErrors.length > 0 || periodErrors.length > 0 || (isMultiPeriod && seriesValidation?.valid === false)) && (() => {
          const blockingMessages = [...invalidPaxErrors, ...capacityErrors, ...overbookingErrors, ...periodErrors, ...(isMultiPeriod && seriesValidation?.valid === false ? ["השיבוץ הרב־תקופתי הקיים חלקי או לא עקבי — השמירה חסומה."] : [])];
          return <details open className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-red-700">שגיאות חוסמות · {blockingMessages.length} — הצג פרטים</summary><div className="mt-2 space-y-1 border-t border-red-100 pt-2">{blockingMessages.map((message, index) => <p key={index} className="flex items-start gap-1.5 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message}</p>)}</div></details>;
        })()}

        {totalAssigned > 0 && !hasBlockingErrors && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            מוכן לשמירה — {totalAssigned} אנשים ב-{tents.filter(t => Number(paxMap[t.id]) > 0).length} אוהלים
          </div>
        )}

        {isMultiPeriod && liveTrace && (
          <div className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-[11px] text-violet-950" dir="ltr">
            <div className="mb-1 font-bold">MP LIVE TRACE 2026-09-14-B</div>
            <pre className="whitespace-pre-wrap break-all font-mono leading-4">{JSON.stringify(liveTrace, null, 2)}</pre>
          </div>
        )}

        <DialogFooter className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>ביטול</Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleSave}
            disabled={saving || hasBlockingErrors || totalAssigned === 0}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "שומר..." : "שמור חלוקה"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}