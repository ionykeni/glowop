import { useState, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle, BedDouble, X, Home, CheckCircle2, Plus, Users, Pencil, Trash2, Unlock
} from "lucide-react";
import { toast } from "sonner";
import { releaseSleepingSeries, actionableSleepingRows } from '@/components/sleeping/seriesActions';
import RoleGate from "@/components/RoleGate";
import { getLogicalAltTentAllocations, ALT_TENT_MARKER } from "@/lib/altTentLogicalAllocations";
import { toSleepingAssignmentPrototype } from "@/lib/vipLogicalAllocations";

const GENDER_OPTIONS = [
  { value: "MEN",   label: "גברים" },
  { value: "WOMEN", label: "נשים"  },
  { value: "MIXED", label: "מעורב" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Countdown header shown inside the modal
// ─────────────────────────────────────────────────────────────────────────────
function CountdownHeader({ required, allocated, pending }) {
  const done = required > 0 && pending === 0;
  return (
    <div className={`rounded-xl border px-4 py-3 ${done ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
      {done ? (
        <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          כל אנשי הצוות שובצו לאוהל חילופי ✓
        </p>
      ) : (
        <p className="text-sm font-semibold text-amber-800">
          נותרו לשיבוץ: <span className="text-lg">{pending}</span> אנשים
        </p>
      )}
      <div className="flex gap-4 mt-1 text-xs text-slate-500">
        <span>סה״כ נדרש: <strong>{required}</strong></span>
        <span>שובצו: <strong>{allocated}</strong></span>
        <span>נותרו: <strong>{pending}</strong></span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Neighborhood card
// ─────────────────────────────────────────────────────────────────────────────
function NeighborhoodCard({ neighborhood, availableTentCount, availableBeds, isSelected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-right rounded-xl border-2 px-4 py-3 transition-all ${
        isSelected
          ? "border-amber-500 bg-amber-50 shadow-md"
          : "border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/40"
      }`}
    >
      <p className={`text-sm font-bold ${isSelected ? "text-amber-800" : "text-slate-700"}`}>
        {neighborhood.name}
      </p>
      <p className="text-xs text-slate-500 mt-0.5">
        {availableTentCount} אוהלים פנויים · {availableBeds} מיטות זמינות
      </p>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tent card inside a selected neighborhood
// ─────────────────────────────────────────────────────────────────────────────
function TentCard({ tent, selectedPax, maxPax, onChangePax, onRemove }) {
  const isSelected = selectedPax > 0;

  return (
    <div className={`rounded-xl border-2 p-3 transition-all ${
      isSelected ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
    }`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className={`text-sm font-bold ${isSelected ? "text-amber-800" : "text-slate-700"}`}>
            אוהל {tent.code}
          </p>
          <p className="text-xs text-slate-400">קיבולת: {tent.capacity} מיטות</p>
        </div>
        {isSelected && (
          <button
            type="button"
            onClick={() => onRemove()}
            className="text-red-400 hover:text-red-600 transition-colors p-0.5"
            title="הסר"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Pax selector — inline button group */}
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: tent.capacity }, (_, i) => i + 1).map(n => {
          // Disable options beyond maxPax unless that's the currently selected value
          const isDisabled = n > maxPax && n !== selectedPax;
          const isActive   = n === selectedPax;
          return (
            <button
              key={n}
              type="button"
              disabled={isDisabled}
              onClick={() => onChangePax(n)}
              className={`w-8 h-8 rounded-lg text-xs font-semibold border-2 transition-all ${
                isActive
                  ? "border-amber-500 bg-amber-500 text-white shadow"
                  : isDisabled
                    ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                    : "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {isSelected && (
        <p className="text-[11px] text-amber-700 mt-1.5 font-medium">{selectedPax} אנשים נבחרו</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary row for the right-side "cart"
// ─────────────────────────────────────────────────────────────────────────────
function SelectionSummaryRow({ tent, neighborhood, pax, gender, onEdit, onRemove }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <BedDouble className="w-4 h-4 text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-800 truncate">אוהל {tent?.code}</p>
        <p className="text-xs text-slate-500">{neighborhood} · {pax} אנשים · {GENDER_OPTIONS.find(g => g.value === gender)?.label || gender}</p>
      </div>
      <button type="button" onClick={onEdit} className="text-slate-400 hover:text-amber-600 p-0.5">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={onRemove} className="text-slate-400 hover:text-red-500 p-0.5">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gender picker for a selection item
// ─────────────────────────────────────────────────────────────────────────────
function GenderPicker({ value, onChange }) {
  return (
    <div className="flex gap-1.5">
      {GENDER_OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-medium transition-all ${
            value === opt.value
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main modal
// ─────────────────────────────────────────────────────────────────────────────
function AltTentAllocationModal({
  profile, groupId, allTents, neighborhoods,
  existingAltAllocs,   // already-saved alt tent rows for this group
  availableTents,      // tents not occupied by other groups (DRAFT + CONFIRMED from others)
  arrivalDate, departureDate,
  onSaved, onClose,
  isMultiPeriod = false,
  canUseMultiPeriod = false,
  periodizedAssignments = [],
}) {
  const required      = profile.staff_alt_tent_pax ?? 0;
  const altTentNotes  = profile.staff_alt_tent_notes || "";

  // ── local state ────────────────────────────────────────────────────────────
  // selections: { [tentId]: { pax, gender, notes, existingAllocId? } }
  const [selections, setSelections] = useState(() => {
    const init = {};
    existingAltAllocs.forEach(a => {
      const cleanNotes = (a.notes || "").replace(/__alt_tent__\s*/g, "").trim();
      init[a.tent_id] = { pax: a.allocated_pax || 1, gender: a.gender_group || "MIXED", notes: cleanNotes, existingAllocId: a.id };
    });
    return init;
  });

  const [selectedHoodId,  setSelectedHoodId]  = useState(null);
  const [editingTentId,   setEditingTentId]    = useState(null); // tentId being edited in inline panel
  const [saving,          setSaving]           = useState(false);
  const [errors,          setErrors]           = useState([]);

  // ── derived ────────────────────────────────────────────────────────────────
  const allocatedPax  = Object.values(selections).reduce((s, v) => s + (v.pax || 0), 0);
  const remainingPax  = Math.max(required - allocatedPax, 0);

  // Available tents grouped by neighborhood (exclude already-selected-by-others but include own selections)
  const availableByHood = useMemo(() => {
    const map = {};
    availableTents.forEach(t => {
      if (!map[t.neighborhood_id]) map[t.neighborhood_id] = [];
      map[t.neighborhood_id].push(t);
    });
    // Also include tents that are in our existing selections (they were excluded from availableTents)
    Object.keys(selections).forEach(tentId => {
      const t = allTents.find(tt => tt.id === tentId);
      if (!t) return;
      if (!map[t.neighborhood_id]) map[t.neighborhood_id] = [];
      if (!map[t.neighborhood_id].some(tt => tt.id === tentId)) {
        map[t.neighborhood_id].push(t);
      }
    });
    return map;
  }, [availableTents, allTents, selections]);

  // Neighborhoods with available tents (non-VIP, sorted by sort_order)
  // Per new rule: neighborhood is NOT blocked just because another group uses it.
  // Only tent-level conflicts are blocked (handled via occupiedTentIds above).
  const availableNeighborhoods = useMemo(() => {
    return neighborhoods
      .filter(n => {
        if (n.is_vip) return false;
        const tentsInHood = availableByHood[n.id] || [];
        return tentsInHood.length > 0;
      })
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [neighborhoods, availableByHood]);

  // Tents in the selected neighborhood
  const selectedHoodTents = useMemo(() => {
    if (!selectedHoodId) return [];
    return (availableByHood[selectedHoodId] || []).sort((a, b) => (a.code || "").localeCompare(b.code || "", "he"));
  }, [selectedHoodId, availableByHood]);

  // maxPax for a given tent (considering remaining + what's already selected for that tent)
  const maxPaxForTent = useCallback((tent) => {
    const alreadyForThisTent = selections[tent.id]?.pax || 0;
    return Math.min(tent.capacity, remainingPax + alreadyForThisTent);
  }, [remainingPax, selections]);

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleSetPax = (tentId, pax) => {
    setSelections(prev => ({
      ...prev,
      [tentId]: { ...(prev[tentId] || { gender: "MIXED", notes: "" }), pax },
    }));
  };

  const handleRemove = (tentId) => {
    setSelections(prev => {
      const next = { ...prev };
      delete next[tentId];
      return next;
    });
    if (editingTentId === tentId) setEditingTentId(null);
  };

  const handleGenderChange = (tentId, gender) => {
    setSelections(prev => ({
      ...prev,
      [tentId]: { ...(prev[tentId] || { pax: 1, notes: "" }), gender },
    }));
  };

  // ── save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setErrors([]);
    const entries = Object.entries(selections);

    // Validation
    const errs = [];
    if (entries.length === 0 && required > 0) errs.push("יש לבחור לפחות אוהל אחד");
    entries.forEach(([tentId, sel]) => {
      const tent = allTents.find(t => t.id === tentId);
      if (!tent) { errs.push(`אוהל ${tentId} לא נמצא`); return; }
      if (!sel.pax || sel.pax < 1) errs.push(`יש לבחור מספר אנשים לאוהל ${tent.code}`);
      if (sel.pax > tent.capacity) errs.push(`מספר האנשים גדול מקיבולת אוהל ${tent.code}`);
    });
    if (errs.length) { setErrors(errs); return; }

    if (isMultiPeriod && !canUseMultiPeriod) {
      setErrors(["שיבוץ אוהל חילופי רב־תקופתי זמין רק למכינה מאושרת ופעילה תפעולית"]);
      return;
    }
    if (isMultiPeriod && existingAltAllocs.some(a => !selections[a.tent_id])) {
      setErrors(['להסרת אוהל קיים יש להשתמש בכפתור השחרור שלו; יתר השיבוצים יישמרו.']);
      return;
    }
    const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
    const existingTentIds = new Set(existingAltAllocs.map(a => a.tent_id));
    const changesActiveLocation = existingAltAllocs.some(a => a.status === "CONFIRMED" && a.arrival_date <= todayIL && a.departure_date > todayIL) &&
      (entries.some(([tentId]) => !existingTentIds.has(tentId)) || existingAltAllocs.some(a => !selections[a.tent_id]));
    if (!isMultiPeriod && changesActiveLocation) {
      setErrors(["שינוי מקום של שיבוץ מאושר פעיל מחייב בחירה ב׳שנה החל מתאריך׳."]);
      return;
    }

    setSaving(true);
    const failed = [];

    if (isMultiPeriod) {
      const altAssignments = entries.map(([tentId, sel]) => {
        const tent = allTents.find(item => item.id === tentId);
        const cleanNotes = (sel.notes || "").replace(/__alt_tent__\s*/g, "").trim();
        return {
          allocation_series_id: existingAltAllocs.find(a => a.tent_id === tentId)?.allocation_series_id,
          tent_id: tentId,
          neighborhood_id: tent.neighborhood_id,
          allocated_pax: Number(sel.pax),
          allocation_type: "STAFF",
          gender_group: sel.gender || "MIXED",
          notes: `${ALT_TENT_MARKER}${cleanNotes ? ` ${cleanNotes}` : ""}`,
        };
      });
      const editedSeries = new Set(existingAltAllocs.map(a => a.allocation_series_id));
      const assignments = [...periodizedAssignments.filter(a => !editedSeries.has(a.allocation_series_id)), ...altAssignments];
      try {
        const preview = await base44.functions.invoke("previewMultiPeriodSleepingPlanV3", { group_id: groupId, assignments });
        if (!preview.data?.success || !preview.data?.allowed) {
          const conflicts = preview.data?.exact_tent_conflicts || [];
          const details = conflicts.map(item => `אוהל תפוס בתקופה ${item.planned_period?.arrival_date}–${item.planned_period?.departure_date}`);
          failed.push(...(details.length ? details : [preview.data?.error || "האוהל אינו פנוי בכל תקופות השהייה הפעילות"]));
        } else {
          const commit = await base44.functions.invoke("commitMultiPeriodSleepingPlanCurrent", { group_id: groupId, assignments });
          if (!commit.data?.success) failed.push(commit.data?.error || "שמירת השיבוץ הרב־תקופתי נכשלה");
        }
      } catch (err) {
        failed.push(err?.response?.data?.error || err?.message || "שמירת השיבוץ הרב־תקופתי נכשלה");
      }
      setSaving(false);
      if (failed.length) setErrors(failed);
      else {
        toast.success(`שיבוץ אוהלים חילופיים נשמר לכל תקופות השהייה — ${entries.length} אוהלים ✓`);
        onSaved();
      }
      return;
    }

    // CONTINUOUS: keep the existing save function and row behavior unchanged.
    // Save each selection sequentially
    for (const [tentId, sel] of entries) {
      try {
        const res = await base44.functions.invoke("saveAltTentAllocation", {
          allocation_id:                sel.existingAllocId || null,
          group_id:                     groupId,
          operational_group_profile_id: profile.id,
          tent_id:                      tentId,
          gender_group:                 sel.gender || "MIXED",
          allocated_pax:                Number(sel.pax),
          notes:                        sel.notes || "",
        });
        if (!res.data?.success) {
          const tent = allTents.find(t => t.id === tentId);
          failed.push(`אוהל ${tent?.code || tentId}: ${res.data?.error || "שגיאה"}`);
        }
      } catch (err) {
        const tent = allTents.find(t => t.id === tentId);
        failed.push(`אוהל ${tent?.code || tentId}: ${err?.response?.data?.error || err?.message || "שגיאה"}`);
      }
    }

    // Cancel removed existing allocs (existingAltAllocs not in current selections)
    const removedAllocs = existingAltAllocs.filter(a => !selections[a.tent_id]);
    for (const alloc of removedAllocs) {
      try {
        if (alloc.status === "DRAFT") {
          await base44.entities.SleepingAllocation.delete(alloc.id);
        } else {
          await base44.entities.SleepingAllocation.update(alloc.id, { status: "CANCELLED" });
        }
      } catch (err) {
        const tent = allTents.find(t => t.id === alloc.tent_id);
        failed.push(`שחרור אוהל ${tent?.code || alloc.tent_id}: ${err?.message || "שגיאה"}`);
      }
    }

    setSaving(false);

    if (failed.length > 0) {
      setErrors(failed);
    } else {
      const savedCount = entries.length;
      if (remainingPax > 0) {
        toast.success(`נשמרו ${savedCount} אוהלים חילופיים — נותרו ${remainingPax} אנשים ללא שיבוץ`);
      } else {
        toast.success(`שיבוץ אוהלים חילופיים נשמר — ${savedCount} אוהלים ✓`);
      }
      onSaved();
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  const selectedNeighborhood = neighborhoods.find(n => n.id === selectedHoodId);
  const selectionEntries = Object.entries(selections);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        dir="rtl"
      >
        {/* ── sticky header ── */}
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-slate-100 space-y-3">
          <DialogTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Home className="w-5 h-5 text-amber-600" />
            שיבוץ אוהל חילופי לצוות
          </DialogTitle>

          <CountdownHeader
            required={required}
            allocated={allocatedPax}
            pending={remainingPax}
          />

          {altTentNotes && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              הערות: {altTentNotes}
            </p>
          )}
        </div>

        {/* ── body — 3 column layout on desktop, stacked on mobile ── */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">

          {/* Column 1: Neighborhood list */}
          <div className="md:w-48 shrink-0 border-b md:border-b-0 md:border-l border-slate-100 overflow-y-auto p-3 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 px-1 mb-2">שכונה</p>
            {availableNeighborhoods.length === 0 ? (
              <p className="text-xs text-slate-400 px-1">אין שכונות פנויות בתאריכים אלו.</p>
            ) : (
              availableNeighborhoods.map(hood => {
                const tentsInHood  = availableByHood[hood.id] || [];
                const availableBeds = tentsInHood.reduce((s, t) => s + (t.capacity || 0), 0);
                return (
                  <NeighborhoodCard
                    key={hood.id}
                    neighborhood={hood}
                    availableTentCount={tentsInHood.length}
                    availableBeds={availableBeds}
                    isSelected={selectedHoodId === hood.id}
                    onClick={() => setSelectedHoodId(hood.id)}
                  />
                );
              })
            )}
          </div>

          {/* Column 2: Tent grid for selected neighborhood */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!selectedHoodId ? (
              <div className="text-center py-12 text-slate-400">
                <Home className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">בחר שכונה מהרשימה</p>
              </div>
            ) : selectedHoodTents.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">אין אוהלים פנויים בשכונה זו.</p>
            ) : (
              <>
                <p className="text-xs font-semibold text-slate-500">
                  {selectedNeighborhood?.name} — {selectedHoodTents.length} אוהלים זמינים
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {selectedHoodTents.map(tent => {
                    const sel    = selections[tent.id];
                    const curPax = sel?.pax || 0;
                    const max    = maxPaxForTent(tent);
                    return (
                      <div key={tent.id}>
                        <TentCard
                          tent={tent}
                          selectedPax={curPax}
                          maxPax={max}
                          onChangePax={(n) => handleSetPax(tent.id, n)}
                          onRemove={() => handleRemove(tent.id)}
                        />
                        {/* inline gender picker when selected */}
                        {curPax > 0 && (
                          <div className="mt-1.5 px-0.5">
                            <p className="text-[10px] text-slate-400 mb-1">מגדר:</p>
                            <GenderPicker
                              value={sel?.gender || "MIXED"}
                              onChange={(g) => handleGenderChange(tent.id, g)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Column 3: Selection summary */}
          <div className="md:w-64 shrink-0 border-t md:border-t-0 md:border-r border-slate-100 overflow-y-auto p-4 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">סיכום בחירה</p>

            {selectionEntries.length === 0 ? (
              <p className="text-xs text-slate-400">לא נבחרו אוהלים עדיין.</p>
            ) : (
              <div className="space-y-2">
                {selectionEntries.map(([tentId, sel]) => {
                  const tent = allTents.find(t => t.id === tentId);
                  const hood = tent ? (neighborhoods.find(n => n.id === tent.neighborhood_id)?.name || "") : "";
                  return (
                    <SelectionSummaryRow
                      key={tentId}
                      tent={tent}
                      neighborhood={hood}
                      pax={sel.pax}
                      gender={sel.gender}
                      onEdit={() => {
                        const hoodId = tent?.neighborhood_id;
                        if (hoodId) setSelectedHoodId(hoodId);
                        setEditingTentId(tentId);
                      }}
                      onRemove={() => handleRemove(tentId)}
                    />
                  );
                })}

                <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                  allocatedPax > required ? "bg-amber-50 text-amber-700 border border-amber-300"
                  : remainingPax === 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-slate-50 text-slate-600 border border-slate-200"
                }`}>
                  {allocatedPax > required
                    ? `⚠️ שובצו יותר מקומות לינה מהדרישה הנוכחית (${allocatedPax}/${required})`
                    : remainingPax === 0
                      ? `✓ ${allocatedPax}/${required} — מלא`
                      : `${allocatedPax}/${required} — נותרו ${remainingPax}`
                  }
                </div>
              </div>
            )}

            {remainingPax > 0 && selectionEntries.length > 0 && (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                נותרו {remainingPax} אנשי צוות ללא שיבוץ אוהל חילופי
              </p>
            )}
          </div>
        </div>

        {/* ── sticky footer ── */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-3 space-y-2">
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> {e}
                </p>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              ביטול
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 gap-1.5 min-w-[160px]"
            >
              <BedDouble className="w-4 h-4" />
              {saving ? "שומר..." : "שמור שיבוץ אוהלים חילופיים"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel shown inline on the allocation tab
// ─────────────────────────────────────────────────────────────────────────────
export default function AltTentAllocationPanel({
  profile,
  groupId,
  allTents,
  neighborhoods,
  myAllocations,
  allActiveAllocations,   // DRAFT + CONFIRMED from all groups — for tent-level conflict detection
  arrivalDate,
  departureDate,
  onInvalidate,
  isMultiPeriod = false,
  canUseMultiPeriod = false,
  logicalAssignments = [],
  activeStayPeriods = [],
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [releasingId, setReleasingId] = useState(null);

  const altTentPax   = profile.staff_alt_tent_pax ?? 0;
  const altTentNotes = profile.staff_alt_tent_notes || "";

  // All active alt tent allocations for this group
  const altAllocs = useMemo(
    () => isMultiPeriod
      ? getLogicalAltTentAllocations(actionableSleepingRows(myAllocations))
      : myAllocations.filter(a => a.status !== "CANCELLED" && (a.notes || "").includes(ALT_TENT_MARKER)),
    [myAllocations, isMultiPeriod]
  );
  const periodizedAssignments = useMemo(
    () => logicalAssignments.filter(item => !item.inconsistent).map(toSleepingAssignmentPrototype),
    [logicalAssignments]
  );

  const allocatedPax  = altAllocs.reduce((s, a) => s + (a.allocated_pax || 0), 0);
  const remainingPax  = Math.max(altTentPax - allocatedPax, 0);
  const allDone       = altTentPax > 0 && remainingPax === 0;

  // Tents occupied on overlapping dates — ALL groups including same group.
  // Exception: existing alt-tent allocs for THIS group are shown in the panel with שחרר button,
  // so exclude them from the blocked set (they are already excluded from availableTents via myAltTentIds).
  const myAltAllocIds = useMemo(() => new Set(altAllocs.flatMap(a =>
    isMultiPeriod ? (a.period_rows || []).map(row => row.id) : [a.id]
  )), [altAllocs, isMultiPeriod]);

  const occupiedTentIds = useMemo(() => {
    const ids = new Set();
    if (isMultiPeriod ? activeStayPeriods.length === 0 : (!arrivalDate || !departureDate)) return ids;
    // Allocations that already ended (departure <= today) don't block — guests already left
    const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
    (allActiveAllocations || []).forEach(a => {
      if (a.status === "CANCELLED") return;
      // Skip this group's own existing alt-tent rows (handled separately in panel)
      if (myAltAllocIds.has(a.id)) return;
      if (a.departure_date && a.departure_date <= todayIL) return;
      const overlaps = isMultiPeriod
        ? activeStayPeriods.some(period => a.arrival_date < period.end_date && a.departure_date > period.start_date)
        : a.arrival_date && a.departure_date && a.arrival_date < departureDate && a.departure_date > arrivalDate;
      if (overlaps) ids.add(a.tent_id);
    });
    return ids;
  }, [allActiveAllocations, arrivalDate, departureDate, myAltAllocIds, isMultiPeriod, activeStayPeriods]);

  // Tent IDs already used by this group's alt allocs (excluded from picker — managed inside modal)
  const myAltTentIds = useMemo(() => new Set(altAllocs.map(a => a.tent_id)), [altAllocs]);

  // Available regular tents: not VIP, working, not occupied by others, not already mine
  const availableTents = useMemo(() => {
    if (isMultiPeriod ? activeStayPeriods.length === 0 : (!arrivalDate || !departureDate)) return [];
    return allTents.filter(t => {
      if (t.tent_type === "VIP") return false;
      if (t.working_status !== "WORKING") return false;
      if (myAltTentIds.has(t.id)) return false;
      if (occupiedTentIds.has(t.id)) return false;
      return true;
    });
  }, [allTents, occupiedTentIds, myAltTentIds, arrivalDate, departureDate, isMultiPeriod, activeStayPeriods]);

  const handleRelease = async (alloc) => {
    if (isMultiPeriod) {
      if (!window.confirm('לשחרר רק את השיבוץ הנוכחי והעתידי של אוהל זה? ההיסטוריה תישמר.')) return;
      setReleasingId(alloc.id);
      try { await releaseSleepingSeries(groupId, alloc.allocation_series_id); onInvalidate(); toast.success('האוהל שוחרר; יתר השיבוצים נשמרו'); }
      catch (err) { toast.error(err.message); }
      finally { setReleasingId(null); }
      return;
    }
    setReleasingId(alloc.id);
    try {
      if (alloc.status === "DRAFT") {
        await base44.entities.SleepingAllocation.delete(alloc.id);
      } else {
        await base44.entities.SleepingAllocation.update(alloc.id, { status: "CANCELLED" });
      }
      toast.success("האוהל החילופי שוחרר");
      onInvalidate();
    } catch (err) {
      toast.error(err?.message || "שגיאה בשחרור האוהל");
    } finally {
      setReleasingId(null);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <Home className="w-4 h-4 text-amber-600" />
        אוהל חילופי לצוות
      </h3>

      {/* Status bar */}
      <div className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${
        allDone ? "bg-emerald-50 border-emerald-300" : altTentPax > 0 ? "bg-amber-50 border-amber-300" : "bg-slate-50 border-slate-200"
      }`}>
        <div className="space-y-0.5">
          {altTentPax > 0 ? (
            <>
              <p className={`text-sm font-semibold ${allDone ? "text-emerald-800" : "text-amber-800"}`}>
                {allDone ? "כל אנשי הצוות שובצו לאוהל חילופי ✓" : `נותרו לשיבוץ: ${remainingPax} אנשים`}
              </p>
              <p className="text-xs text-slate-500">
                סה״כ נדרש: {altTentPax} · שובץ: {allocatedPax} · נותרו: {remainingPax}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">לא הוגדרו דרישות אוהל חילופי — ניתן לשבץ ידנית במידת הצורך</p>
          )}
          {altTentNotes && <p className="text-xs text-amber-700">הערות: {altTentNotes}</p>}
        </div>
        <RoleGate permission="MANAGE_ALLOCATION">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setModalOpen(true);
            }}
            className={`gap-1 shrink-0 ${
              allDone
                ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                : altTentPax > 0
                  ? "border-amber-400 text-amber-700 hover:bg-amber-100"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {altAllocs.length > 0 ? "ערוך שיבוץ" : "שבץ אוהל חילופי"}
          </Button>
        </RoleGate>
      </div>

      {/* Compact list of assigned alt tents */}
      {altAllocs.length > 0 && (
        <div className="space-y-2">
          {altAllocs.map(alloc => {
            const tent      = allTents.find(t => t.id === alloc.tent_id);
            const hoodName  = tent ? (neighborhoods.find(n => n.id === tent.neighborhood_id)?.name || "") : "";
            const isConfirmed = alloc.status === "CONFIRMED";
            const isReleasing = releasingId === alloc.id;
            return (
              <div key={alloc.id} className={`rounded-xl border-2 px-4 py-2.5 flex items-center gap-3 ${
                isConfirmed ? "border-emerald-400 bg-emerald-50" : "border-amber-300 bg-amber-50"
              }`}>
                <BedDouble className={`w-4 h-4 shrink-0 ${isConfirmed ? "text-emerald-600" : "text-amber-600"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isConfirmed ? "text-emerald-800" : "text-amber-800"}`}>
                    אוהל {tent?.code ?? "?"} — {alloc.allocated_pax}/{tent?.capacity ?? "?"} אנשים
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-2">
                    {hoodName && <span>{hoodName}</span>}
                    {isConfirmed
                      ? <span className="text-emerald-600 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" />מאושר</span>
                      : <span className="text-amber-600">טיוטה</span>}
                  </p>
                </div>
                <RoleGate permission="MANAGE_ALLOCATION">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isReleasing}
                    onClick={() => handleRelease(alloc)}
                    className="gap-1 shrink-0 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    {isReleasing ? "משחרר..." : "שחרר"}
                  </Button>
                </RoleGate>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <AltTentAllocationModal
          profile={{ ...profile, arrival_date: arrivalDate, departure_date: departureDate }}
          groupId={groupId}
          allTents={allTents}
          neighborhoods={neighborhoods}
          existingAltAllocs={altAllocs}
          availableTents={availableTents}
          arrivalDate={arrivalDate}
          departureDate={departureDate}
          onSaved={() => { setModalOpen(false); onInvalidate(); }}
          onClose={() => setModalOpen(false)}
          isMultiPeriod={isMultiPeriod}
          canUseMultiPeriod={canUseMultiPeriod}
          periodizedAssignments={periodizedAssignments}
        />
      )}
    </section>
  );
}