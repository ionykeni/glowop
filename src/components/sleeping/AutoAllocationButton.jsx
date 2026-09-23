/**
 * AutoAllocationButton
 *
 * Handles both single-gender (MIXED) and dual-gender (BOYS + GIRLS) automatic allocation.
 *
 * When a gender split exists (boys_count + girls_count > 0):
 *   - Reads boys_tent_distribution_json and girls_tent_distribution_json separately
 *   - Subtracts already-allocated BOYS pax and GIRLS pax independently
 *   - Assigns BOYS first then GIRLS from the same pool of available tents (sequential, no mixing)
 *
 * When no gender split:
 *   - Uses boys_tent_distribution_json as the general/MIXED distribution
 *   - Creates MIXED allocations
 */

import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Wand2, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import RoleGate from "@/components/RoleGate";

// ── Pure helpers ───────────────────────────────────────────────────────────────



function tentSortKey(tent) {
  const m = String(tent.code || "").match(/(\d+)/);
  return m ? Number(m[1]) : 9999;
}

function datesOverlap(a1, a2, b1, b2) {
  if (!a1 || !a2 || !b1 || !b2) return false;
  return a1 < b2 && b1 < a2;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AutoAllocationButton({
  neighborhood,
  tents = [],
  profile,
  groupId,
  profileId,
  arrivalDate,
  departureDate,
  allConfirmedAllocs = [],
  allActiveAllocs = [],
  existingGroupAllocs = [],
  onSaved,
  isMultiPeriod = false,
  canUseMultiPeriod = false,
  activeStayPeriods = [],
  logicalAssignments = [],
  seriesValidation = null,
  sharedNeighborhoods = [],
}) {
  const [preview, setPreview] = useState(null); // null | { segments: [{gender, rows}], error }
  const [saving, setSaving]   = useState(false);
  const [done, setDone]       = useState(false);
  const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const allocationStartDate = !isMultiPeriod && arrivalDate <= todayIL && todayIL < departureDate
    ? todayIL
    : arrivalDate;

  // Does the group have a gender split?
  const hasGenderSplit = useMemo(() =>
    ((profile?.boys_count || 0) + (profile?.girls_count || 0)) > 0,
    [profile]
  );

  // Tents blocked by OTHER groups (overbooking check)
  const blockedTentIds = useMemo(() => {
    const set = new Set();
    (isMultiPeriod ? allActiveAllocs : allConfirmedAllocs).forEach(a => {
      if (a.group_id === groupId || a.status === "CANCELLED") return;
      const overlapsRequiredStay = isMultiPeriod
        ? activeStayPeriods.some(period => period.end_date > todayIL && a.departure_date > todayIL && datesOverlap(period.start_date < todayIL ? todayIL : period.start_date, period.end_date, a.arrival_date, a.departure_date))
        : datesOverlap(allocationStartDate, departureDate, a.arrival_date, a.departure_date);
      if (overlapsRequiredStay) set.add(a.tent_id);
    });
    return set;
  }, [allConfirmedAllocs, allActiveAllocs, groupId, allocationStartDate, departureDate, isMultiPeriod, activeStayPeriods, todayIL]);

  // Tents already allocated by THIS group in this neighborhood (any status except cancelled)
  const usedByMeTentIds = useMemo(() => new Set(
    existingGroupAllocs
      .filter(a => a.status !== "CANCELLED" && a.neighborhood_id === neighborhood?.id && (!isMultiPeriod || a.departure_date > todayIL))
      .map(a => a.tent_id)
  ), [existingGroupAllocs, neighborhood, isMultiPeriod, todayIL]);

  // Already-allocated pax per gender across ALL neighborhoods.
  // MULTI_PERIOD counts one logical series once, never once per physical period row.
  const allocatedPaxByGender = useMemo(() => {
    const map = { BOYS: 0, GIRLS: 0, MIXED: 0 };
    const source = isMultiPeriod
      ? logicalAssignments.filter(a => !a.inconsistent && a.allocation_type === "STUDENT")
      : existingGroupAllocs.filter(a => a.status !== "CANCELLED" && a.allocation_type === "STUDENT");
    source.forEach(a => {
      const g = a.gender_group;
      if (map[g] !== undefined) map[g] += Number(isMultiPeriod ? a.logical_allocated_pax : a.allocated_pax) || 0;
    });
    return map;
  }, [isMultiPeriod, logicalAssignments, existingGroupAllocs]);

  // ── Core: compute what still needs to be allocated ──────────────────────────
  // Available tents sorted (needed for capacity-aware auto-expand)
  const sortedAvailableTents = useMemo(() =>
    tents
      .filter(t => t.working_status === "WORKING" && !blockedTentIds.has(t.id) && !usedByMeTentIds.has(t.id))
      .sort((a, b) => tentSortKey(a) - tentSortKey(b)),
    [tents, blockedTentIds, usedByMeTentIds]
  );

  // ── Compute required remaining pax per segment (total-based, not slot-based) ──
  const segments = useMemo(() => {
    if (!profile) return [];

    if (hasGenderSplit) {
      // Total pax required for boys / girls
      const totalBoys  = profile.boys_beds_needed  || profile.boys_count  || 0;
      const totalGirls = profile.girls_beds_needed || profile.girls_count || 0;
      const boysNeeded  = Math.max(0, totalBoys  - allocatedPaxByGender.BOYS);
      const girlsNeeded = Math.max(0, totalGirls - allocatedPaxByGender.GIRLS);

      return [
        boysNeeded  > 0 ? { gender: "BOYS",  label: "בנים", requiredPax: boysNeeded  } : null,
        girlsNeeded > 0 ? { gender: "GIRLS", label: "בנות", requiredPax: girlsNeeded } : null,
      ].filter(Boolean);
    } else {
      // MIXED/general
      const totalPax  = profile.participant_count || profile.total_pax || 0;
      const mixedNeeded = Math.max(0, totalPax - allocatedPaxByGender.MIXED);
      return mixedNeeded > 0
        ? [{ gender: "MIXED", label: "כללי", requiredPax: mixedNeeded }]
        : [];
    }
  }, [profile, hasGenderSplit, allocatedPaxByGender]);

  const totalRemainingPax = segments.reduce((s, seg) => s + seg.requiredPax, 0);

  // ── Run allocation logic ────────────────────────────────────────────────────
  const runAutoAllocation = () => {
    setDone(false);

    if (isMultiPeriod && !canUseMultiPeriod) {
      setPreview({ error: "שיבוץ אוטומטי רב־תקופתי זמין רק למכינה מאושרת ופעילה תפעולית." });
      return;
    }
    if (isMultiPeriod && seriesValidation?.valid === false) {
      setPreview({ error: "השיבוץ הרב־תקופתי הקיים אינו עקבי. נדרשת בדיקה לפני שיבוץ אוטומטי." });
      return;
    }
    if (!profile) {
      setPreview({ error: "אין פרופיל תפעולי — נא להשלים את פרטי הקבוצה." });
      return;
    }

    if (segments.length === 0) {
      setPreview({ error: "כל המשתתפים כבר שובצו — אין משתתפים שנותרו לשיבוץ." });
      return;
    }

    // Available tents pool — reuse the memoized sortedAvailableTents
    const available = sortedAvailableTents;

    if (available.length === 0) {
      setPreview({ error: "אין אוהלים פנויים בשכונה זו לשיבוץ." });
      return;
    }

    // TOTAL-BASED FILL: drive allocation by remaining required pax,
    // not by the original slot list. This ensures smaller-capacity tents
    // add extra tents to cover the full required count.
    const result = [];
    let tentCursor = 0;
    let isPartial = false;

    for (const seg of segments) {
      const rows = [];
      let remaining = seg.requiredPax;

      while (remaining > 0) {
        const tent = available[tentCursor];
        if (!tent) {
          // No more tents in this neighborhood — partial fill
          isPartial = true;
          break;
        }
        const effectivePax = Math.min(remaining, tent.capacity || 8);
        rows.push({ tent, pax: effectivePax });
        remaining -= effectivePax;
        tentCursor++;
      }

      if (rows.length > 0) {
        result.push({
          gender: seg.gender,
          label: seg.label,
          rows,
          allocatedPax: rows.reduce((s, r) => s + r.pax, 0),
          requiredPax: seg.requiredPax,
        });
      }
    }

    if (result.length === 0) {
      setPreview({ error: "לא ניתן לשבץ אף אוהל בשכונה זו." });
      return;
    }

    const allocatedPax = result.reduce((sum, segment) => sum + segment.allocatedPax, 0);
    setPreview({
      segments: result,
      error: null,
      isPartial,
      allocatedPax,
      remainingPax: Math.max(0, totalRemainingPax - allocatedPax),
    });
  };

  const buildLogicalAssignments = () => preview.segments.flatMap(seg =>
    seg.rows.map(({ tent, pax }) => ({
      tent_id: tent.id,
      neighborhood_id: neighborhood.id,
      allocated_pax: pax,
      allocation_type: "STUDENT",
      gender_group: seg.gender,
      notes: "שיבוץ אוטומטי",
    }))
  );

  const multiPeriodConflictMessage = (result) => {
    const conflict = result?.exact_tent_conflicts?.[0];
    if (!conflict) return "אחד או יותר מהאוהלים שנבחרו אינם זמינים בכל תקופות השהייה של המכינה.";
    const tentCode = tents.find(tent => tent.id === conflict.tent_id)?.code || conflict.tent_id;
    return `אוהל ${tentCode} אינו זמין בכל התקופות: התנגשות בתאריכים ${conflict.planned_period.arrival_date}–${conflict.planned_period.departure_date} עם קבוצה ${conflict.conflicting_group_id}.`;
  };

  // ── Save all segments as DRAFT rows ────────────────────────────────────────
  const handleSave = async () => {
    if (!preview?.segments?.length) return;
    setSaving(true);
    try {
      if (isMultiPeriod) {
        const newAssignments = buildLogicalAssignments();
        const existingAssignments = logicalAssignments
          .filter(assignment => !assignment.inconsistent)
          .map(assignment => ({
            allocation_series_id: assignment.allocation_series_id,
            tent_id: assignment.tent_id,
            neighborhood_id: assignment.neighborhood_id,
            allocated_pax: assignment.logical_allocated_pax,
            allocation_type: assignment.allocation_type,
            gender_group: assignment.gender_group,
            notes: assignment.notes || "",
          }));
        const assignments = [...existingAssignments, ...newAssignments];
        const payload = { group_id: groupId, assignments, shared_neighborhoods: sharedNeighborhoods };
        const previewRes = await base44.functions.invoke("previewMultiPeriodSleepingPlanCurrent", payload);
        const previewResult = previewRes.data;
        if (!previewResult?.success || previewResult.legacy_envelope_requires_conversion || !previewResult.allowed) {
          const message = previewResult?.legacy_envelope_requires_conversion
            ? "קיים שיבוץ מעטפת ישן הדורש המרה לפני שיבוץ אוטומטי."
            : multiPeriodConflictMessage(previewResult);
          setPreview({ error: message });
          return;
        }
        const commitRes = await base44.functions.invoke("commitMultiPeriodSleepingPlanCurrent", payload);
        if (!commitRes.data?.success) {
          setPreview({ error: commitRes.data?.error === "INCONSISTENT_PERIODIZED_SLEEPING_STATE"
            ? "השיבוץ הקיים השתנה. יש לרענן ולבדוק לפני הוספת אוהלים."
            : (commitRes.data?.error || "שמירת השיבוץ הרב־תקופתי נכשלה.") });
          return;
        }
        const totalPax = newAssignments.reduce((sum, assignment) => sum + assignment.allocated_pax, 0);
        const remainingPax = preview.remainingPax || 0;
        toast.success(remainingPax > 0
          ? `שובצו ${totalPax} · נותרו ${remainingPax} לשיבוץ`
          : `שיבוץ אוטומטי רב־תקופתי נוצר — ${newAssignments.length} אוהלים · ${totalPax} אנשים ✓`);
        setDone(true);
        setPreview(null);
        onSaved?.();
        return;
      }

      const requested = preview.segments.flatMap(seg => seg.rows.map(({ tent, pax }) => ({ tent_id: tent.id, neighborhood_id: neighborhood.id, allocated_pax: pax, gender_group: seg.gender })));
      const { data } = await base44.functions.invoke('manageScopedSleepingRelease', { action: 'AUTO_CONTINUOUS', group_id: groupId, requested });
      if (!data?.success) throw new Error(data?.error || 'שמירת השיבוץ נכשלה');
      const totalTents = preview.segments.reduce((s, sg) => s + sg.rows.length, 0);
      const totalPax   = preview.segments.reduce((s, sg) => s + sg.rows.reduce((ss, r) => ss + r.pax, 0), 0);
      toast.success(`שיבוץ אוטומטי נוצר — ${totalTents} אוהלים · ${totalPax} אנשים — נא לאשר שיבוץ לינה ✓`);
      setDone(true);
      setPreview(null);
      onSaved?.();
    } catch (err) {
      toast.error(err?.message || "שגיאה בשמירת השיבוץ — נסה שוב");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => { setPreview(null); setDone(false); };

  // ── Render ─────────────────────────────────────────────────────────────────

  const GENDER_STYLE = {
    BOYS:  "bg-emerald-50 border-emerald-200 text-emerald-800",
    GIRLS: "bg-orange-50 border-orange-200 text-orange-800",
    MIXED: "bg-violet-50 border-violet-200 text-violet-800",
  };


  return (
    <div className="space-y-2">
      {/* Trigger */}
      {!preview && !done && (
        <RoleGate permission="MANAGE_ALLOCATION">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-violet-200 text-violet-700 hover:bg-violet-50"
            onClick={runAutoAllocation}
          >
            <Wand2 className="w-3 h-3" />
            שיבוץ אוטומטי
          </Button>
        </RoleGate>
      )}

      {/* Done badge — show button again to allow re-run for next neighborhood */}
      {done && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-violet-100 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
            <CheckCircle2 className="w-3 h-3" /> שיבוץ אוטומטי נוצר
          </span>
          <Button
            size="sm" variant="ghost"
            className="h-6 text-[10px] text-violet-600 px-1"
            onClick={() => setDone(false)}
          >שיבוץ נוסף</Button>
        </div>
      )}

      {/* Preview / error */}
      {preview && (
        <div className="border rounded-xl overflow-hidden bg-white">
          {preview.error ? (
            <div className="flex items-start gap-2 p-3 bg-red-50 border-red-200 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">לא ניתן לבצע שיבוץ אוטומטי</p>
                <p className="mt-0.5">{preview.error}</p>
                <Button size="sm" variant="ghost" className="h-6 text-xs text-red-600 mt-1 px-1" onClick={handleCancel}>סגור</Button>
              </div>
            </div>
          ) : (
            <div className="p-3 space-y-3">
              <p className="text-xs font-semibold text-violet-800 flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5" />
                תצוגה מקדימה — שיבוץ אוטומטי{isMultiPeriod ? " רב־תקופתי" : ""}
                {preview.isPartial && (
                  <span className="text-amber-600 font-normal normal-case">· שיבוץ חלקי — לא כל השכונה מספיקה</span>
                )}
              </p>
              {preview.isPartial && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="font-semibold">שובצו {preview.allocatedPax} · נותרו {preview.remainingPax} לשיבוץ</span>
                </div>
              )}

              {preview.segments.map(seg => {
                const segAllocated = seg.allocatedPax;
                const segRequired  = seg.requiredPax;
                const segPartial   = segAllocated < segRequired;
                return (
                  <div key={seg.gender} className={`border rounded-lg p-2 space-y-1 ${GENDER_STYLE[seg.gender]}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold">
                        {seg.label} — {seg.rows.length} אוהלים
                      </p>
                      <p className={`text-[11px] font-semibold ${segPartial ? "text-amber-700" : "text-emerald-700"}`}>
                        שובץ בשכונה זו: {segAllocated} מתוך {segRequired}
                      </p>
                    </div>
                    {segPartial && (
                      <p className="text-[10px] text-amber-600 font-medium">
                        נותרו לשיבוץ: {segRequired - segAllocated} משתתפים
                      </p>
                    )}
                    {seg.rows.map(({ tent, pax }) => (
                      <div key={tent.id} className="flex items-center justify-between text-xs px-3 py-1.5 border rounded-lg bg-white">
                        <span className="font-semibold text-slate-800">אוהל {tent.code}</span>
                        <span className="font-medium">{pax} מיטות</span>
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCancel} disabled={saving}>ביטול</Button>
                <RoleGate permission="MANAGE_ALLOCATION">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 bg-violet-700 hover:bg-violet-800 text-white flex-1"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> שומר...</>
                      : <><CheckCircle2 className="w-3 h-3" /> {isMultiPeriod ? "צור שיבוץ רב־תקופתי" : "צור שיבוץ טיוטה"}</>
                      }
                      </Button>
                </RoleGate>
              </div>
              <p className="text-[10px] text-slate-400 text-center">
                {isMultiPeriod
                  ? "אותם אוהלים יישמרו כטיוטה בכל תקופות השהייה — לאחר מכן לחץ ״אשר שיבוץ לינה״"
                  : "השיבוץ יישמר כטיוטה — לאחר מכן לחץ ״אשר שיבוץ לינה״ לאישור סופי"}
                </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}