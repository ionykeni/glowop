import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck, AlertTriangle, X, Shield, Car, User, Star, BookOpen, BedDouble, Pencil } from "lucide-react";
import { toast } from "sonner";
import { releaseSleepingSeries, actionableSleepingRows } from '@/components/sleeping/seriesActions';
import VipPaxEditDialog from "./VipPaxEditDialog";
import { getLogicalVipAllocations, toSleepingAssignmentPrototype } from "@/lib/vipLogicalAllocations";

// ── Config ────────────────────────────────────────────────────────────────────

const GENDER_CFG = {
  WOMEN: { label: "נשים",  bg: "bg-orange-50",  border: "border-orange-300",  text: "text-orange-700",  dot: "bg-orange-400",  activeBg: "bg-orange-100" },
  MEN:   { label: "גברים", bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700", dot: "bg-emerald-500", activeBg: "bg-emerald-100" },
  GIRLS: { label: "בנות",  bg: "bg-orange-50",  border: "border-orange-300",  text: "text-orange-700",  dot: "bg-orange-400",  activeBg: "bg-orange-100" },
  BOYS:  { label: "בנים",  bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700", dot: "bg-emerald-500", activeBg: "bg-emerald-100" },
};

const PURPOSE_CFG = {
  STAFF:    { label: "צוות",   Icon: User    },
  SECURITY: { label: "אבטחה",  Icon: Shield  },
  DRIVER:   { label: "נהג",    Icon: Car     },
  VIP:      { label: "VIP",    Icon: Star    },
  GUIDE:    { label: "מדריך",  Icon: BookOpen },
};

function getGenderCfg(g) { return GENDER_CFG[g] || GENDER_CFG.MEN; }
function getPurposeCfg(p) {
  if (!p) return PURPOSE_CFG.STAFF;
  return PURPOSE_CFG[p.toUpperCase()] || { label: p, Icon: User };
}

// ── Operational capacity helper ───────────────────────────────────────────────
// VIP tents and accessible tents support an operational override of up to 4.
function getOperationalMaxPax(tent) {
  const isVip        = tent.tent_type === "VIP" || String(tent.code || "").match(/^8\d/);
  const isAccessible = tent.is_accessible === true;
  if (isVip || isAccessible) return 4;
  return tent.capacity || 8;
}

// ── Assignment Dialog ─────────────────────────────────────────────────────────
// Opens after user selects req → tent. Lets them confirm/adjust/release.

function AssignmentDialog({ req, reqIndex, tent, existingAlloc, profile, group, groupId, neighborhoodId, onSaved, onReleased, onClose, isMultiPeriod, canUseMultiPeriod, periodizedAssignments }) {
  const gc = getGenderCfg(req.gender_group);
  const pc = getPurposeCfg(req.purpose);
  const { Icon } = pc;

  // Normalise gender to MEN/WOMEN for VIP (adult staff)
  const defaultGender = (req.gender_group === "BOYS" || req.gender_group === "MEN") ? "MEN" : "WOMEN";
  const existingGender = existingAlloc?.gender_group;
  const normaliseGender = (g) => (g === "BOYS" || g === "MEN") ? "MEN" : "WOMEN";

  const maxPax = getOperationalMaxPax(tent);

  const [gender, setGender]   = useState(existingGender ? normaliseGender(existingGender) : defaultGender);
  const [pax,    setPax]      = useState(existingAlloc?.allocated_pax ?? Math.min(req.people_count || 1, maxPax));
  const [notes,  setNotes]    = useState((existingAlloc?.notes || "").replace(/__vip_req_\d+__\s*/g, "").trim());
  const [saving,  setSaving]  = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [errors,  setErrors]  = useState([]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const isActiveContinuous = !isMultiPeriod && group?.stay_mode === "CONTINUOUS" && group.arrival_date <= today && today < group.departure_date;
  const isActiveFirstAssignment = isActiveContinuous && !existingAlloc;
  const isActiveReassignment = isActiveContinuous && existingAlloc?.status === "CONFIRMED" && existingAlloc.tent_id !== tent.id;
  const [effectiveDate, setEffectiveDate] = useState(today);
  const effectiveEnd = existingAlloc?.departure_date || group?.departure_date || profile?.departure_date;
  const maxEffectiveDate = effectiveEnd ? new Date(new Date(`${effectiveEnd}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10) : "";

  const isReassign = !!existingAlloc;

  // Frontend validation — quick UX feedback before hitting the server
  const validate = () => {
    const errs = [];
    if (!gender) errs.push("יש לבחור מגדר");
    if (pax < 1) errs.push("מספר האנשים חייב להיות לפחות 1");
    if (pax > maxPax) errs.push(`מקסימום ${maxPax} אנשים לאוהל זה`);
    if ((isActiveFirstAssignment || isActiveReassignment) && !(today <= effectiveDate && effectiveDate < effectiveEnd)) errs.push("תאריך תחילת השינוי חייב להיות מהיום ולפני סיום השיבוץ");
    return errs;
  };

  const handleSave = async () => {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setSaving(true);
    setErrors([]);

    const invokePayload = {
      allocation_id:                existingAlloc?.id || null,
      group_id:                     groupId,
      operational_group_profile_id: profile.id,
      tent_id:                      tent.id,
      requirement_index:            reqIndex,
      gender_group:                 gender,
      allocated_pax:                Number(pax),
      notes:                        notes,
    };
    if (isActiveFirstAssignment) invokePayload.effective_date = effectiveDate;
    console.log("[VIP Alloc] payload →", invokePayload);

    try {
      if (isActiveReassignment) {
        const res = await base44.functions.invoke("reassignSleepingAllocation", {
          allocation_id: existingAlloc.id,
          group_id: groupId,
          destination_tent_id: tent.id,
          effective_date: effectiveDate,
        });
        if (!res.data?.success) {
          setErrors([res.data?.error || "שגיאה בשינוי מקום הלינה"]);
          return;
        }
        toast.success(`אוהל ${tent.code} שויך החל מ-${effectiveDate} ✓`);
        onSaved();
        return;
      }
      if (isMultiPeriod) {
        if (!canUseMultiPeriod) {
          setErrors(["שיבוץ VIP רב־תקופתי זמין רק למכינה מאושרת ופעילה תפעולית."]);
          return;
        }
        const marker = `__vip_req_${reqIndex}__`;
        const cleanNotes = notes.replace(/__vip_req_\d+__\s*/g, "").trim();
        const assignment = {
          allocation_series_id: existingAlloc?.allocation_series_id,
          tent_id: tent.id,
          neighborhood_id: neighborhoodId,
          allocated_pax: Number(pax),
          allocation_type: "STAFF",
          gender_group: existingAlloc?.gender_group || gender,
          notes: existingAlloc?.notes ?? `${marker}${cleanNotes ? " " + cleanNotes : ""}`.trim(),
        };
        const assignments = [...periodizedAssignments.filter(a => !existingAlloc || a.allocation_series_id !== existingAlloc.allocation_series_id), assignment];
        const previewRes = await base44.functions.invoke("previewMultiPeriodSleepingPlanCurrent", { group_id: groupId, assignments });
        const preview = previewRes.data;
        if (!preview?.success || preview.legacy_envelope_requires_conversion || !preview.allowed) {
          const conflict = preview?.exact_tent_conflicts?.[0];
          setErrors([conflict
            ? `אוהל ${tent.code} אינו פנוי בכל תקופות השהייה (${conflict.planned_period.arrival_date}–${conflict.planned_period.departure_date}).`
            : "לא ניתן לשמור את שיבוץ ה-VIP הרב־תקופתי במצב הנוכחי."]);
          return;
        }
        const commitRes = await base44.functions.invoke("commitMultiPeriodSleepingPlanCurrent", { group_id: groupId, assignments });
        if (!commitRes.data?.success) {
          setErrors([commitRes.data?.error === "INCONSISTENT_PERIODIZED_SLEEPING_STATE"
            ? "מצב השיבוץ הרב־תקופתי אינו מאפשר הוספת VIP בטוחה."
            : (commitRes.data?.error || "שגיאה בשמירת שיבוץ VIP רב־תקופתי")]);
          return;
        }
        toast.success(`אוהל ${tent.code} שויך לדרישה #${reqIndex + 1} בכל תקופות השהייה ✓`);
        onSaved();
        return;
      }

      const res = await base44.functions.invoke("saveVipSleepingAllocation", invokePayload);
      console.log("[VIP Alloc] response →", res?.data);

      if (res.data?.success) {
        toast.success(`אוהל ${tent.code} שויך לדרישה #${reqIndex + 1} ✓`);
        onSaved();
      } else {
        if (res.data?.debug) console.warn("[VIP Alloc Debug]", res.data.debug);
        setErrors([res.data?.error || "שגיאה בשמירה"]);
      }
    } catch (err) {
      console.error("[VIP Alloc] catch err →", err?.message);
      const backendData = err?.response?.data;
      console.error("[VIP Save] backend error", backendData);
      if (backendData?.debug) console.warn("[VIP Alloc Debug]", backendData.debug);
      const serverMsg = backendData?.error || backendData?.message || err?.message;
      setErrors([serverMsg || "שגיאה בשמירה — נסה שוב"]);
    } finally {
      setSaving(false);
    }
  };

  const handleRelease = async () => {
    if (!existingAlloc) { onReleased(); return; }
    if (isMultiPeriod) {
      if (!window.confirm('לשחרר רק את השיבוץ הנוכחי והעתידי של דרישה זו? ההיסטוריה תישמר.')) return;
      setReleasing(true); setErrors([]);
      try { await releaseSleepingSeries(groupId, existingAlloc.allocation_series_id); onReleased(); }
      catch (err) { setErrors([err.message]); }
      finally { setReleasing(false); }
      return;
    }
    if (!window.confirm(`לשחרר את אוהל ${tent.code}?`)) return;
    setReleasing(true);
    setErrors([]);
    try {
      if (existingAlloc.status === "DRAFT") {
        await base44.entities.SleepingAllocation.delete(existingAlloc.id);
      } else {
        await base44.entities.SleepingAllocation.update(existingAlloc.id, { status: "CANCELLED" });
      }
      toast.success(`אוהל ${tent.code} שוחרר`);
      onReleased();
    } catch (err) {
      console.error("[VipAllocationPanel] handleRelease error:", err);
      setErrors([err?.response?.data?.error || err?.message || "שגיאה בשחרור — נסה שוב"]);
    } finally {
      setReleasing(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-base flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-primary" />
            {isReassign ? "עריכת שיוך VIP" : "שיוך אוהל VIP"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary row */}
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
            {/* Req badge */}
            <div className={`rounded-lg border ${gc.border} ${gc.bg} px-2.5 py-2 flex flex-col items-center gap-0.5 min-w-[64px]`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center border ${gc.border} ${gc.bg}`}>
                <Icon className={`w-3.5 h-3.5 ${gc.text}`} />
              </div>
              <span className={`text-[10px] font-bold ${gc.text}`}>{gc.label}</span>
              <span className="text-[9px] text-slate-500">{pc.label}</span>
              <span className={`text-[10px] font-semibold ${gc.text}`}>{req.people_count} איש</span>
              <span className="text-[9px] text-slate-400">דרישה #{reqIndex + 1}</span>
            </div>

            <div className="text-slate-300 text-lg font-light">→</div>

            {/* Tent badge */}
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-3 py-2 flex flex-col items-center gap-0.5 min-w-[60px]">
              <BedDouble className="w-5 h-5 text-primary/60" />
              <span className="text-lg font-bold text-primary">{tent.code}</span>
              <span className="text-[10px] text-slate-400">עד 4 🛏️</span>
              {tent.is_accessible && <span className="text-[10px]">♿</span>}
            </div>
          </div>

          {/* Editable fields */}
          <div className="space-y-3">
            {(isActiveFirstAssignment || isActiveReassignment) && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">החל מתאריך</label>
                <input type="date" min={today} max={maxEffectiveDate} value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </div>
            )}
            {/* Gender toggle */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">מגדר</label>
              <div className="flex gap-2">
                {[
                  { value: "MEN",   label: "גברים", color: "emerald" },
                  { value: "WOMEN", label: "נשים",  color: "orange"  },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isMultiPeriod && !!existingAlloc}
                    onClick={() => setGender(opt.value)}
                    className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                      gender === opt.value
                        ? opt.color === "emerald"
                          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                          : "border-orange-400 bg-orange-50 text-orange-700"
                        : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pax stepper */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">
                מספר אנשים
                <span className="text-slate-400 font-normal mr-1">(מקס׳ {maxPax})</span>
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPax(p => Math.max(1, p - 1))}
                  className="w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 text-lg font-bold hover:bg-slate-50 transition-colors flex items-center justify-center"
                >−</button>
                <span className="text-2xl font-bold text-slate-700 min-w-[32px] text-center">{pax}</span>
                <button
                  type="button"
                  onClick={() => setPax(p => Math.min(maxPax, p + 1))}
                  className="w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 text-lg font-bold hover:bg-slate-50 transition-colors flex items-center justify-center"
                >+</button>
                {/* Dot indicators */}
                <div className="flex gap-1 mr-2">
                  {[1,2,3,4].map(n => (
                    <span key={n} className={`w-2.5 h-2.5 rounded-full transition-colors ${n <= pax ? (gender === "MEN" ? "bg-emerald-400" : "bg-orange-400") : "bg-slate-200"}`} />
                  ))}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">הערות <span className="text-slate-400 font-normal">(אופציונלי)</span></label>
              <input
                type="text"
                value={notes}
                disabled={isMultiPeriod && !!existingAlloc}
                onChange={e => setNotes(e.target.value)}
                placeholder="הערות לאוהל..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
            </div>
          </div>

          {isMultiPeriod && existingAlloc && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              שינוי כמות ושחרור יחולו רק על שיבוצים נוכחיים ועתידיים; ההיסטוריה תישמר. שינוי מקום מתבצע בפעולת העברה מתוארכת.
            </div>
          )}

          {/* Validation errors */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> {e}
                </p>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {/* Release — only when something is assigned */}
            {isReassign && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRelease}
                disabled={releasing || saving}
                className="text-red-500 border-red-200 hover:bg-red-50 gap-1"
              >
                <X className="w-3.5 h-3.5" />
                {releasing ? "משחרר..." : "שחרר אוהל"}
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={saving || releasing}>
              ביטול
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || releasing || (isMultiPeriod && !canUseMultiPeriod)}
              className="bg-primary hover:bg-primary/90 gap-1"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {saving ? "שומר..." : isReassign ? "עדכן שיוך" : "שמור שיוך"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── VIP Requirement Card (compact square) ─────────────────────────────────────

function VipReqCard({ req, index, assignedTentCode, assignedStatus, assignedActualPax, isSelected, onClick, editLocked = false, readOnly = false }) {
  const gc = getGenderCfg(req.gender_group);
  const pc = getPurposeCfg(req.purpose);
  const { Icon } = pc;

  const isAssigned  = !!assignedTentCode;
  const isConfirmed = assignedStatus === "CONFIRMED";
  const isDraft     = isAssigned && !isConfirmed;

  let borderCls = gc.border;
  let bgCls     = gc.bg;
  let shadow    = "shadow-sm";

  if (isConfirmed) {
    borderCls = "border-emerald-400"; bgCls = "bg-emerald-50"; shadow = "shadow-md ring-2 ring-emerald-200";
  } else if (isDraft) {
    borderCls = "border-amber-400"; bgCls = "bg-amber-50"; shadow = "shadow-md ring-2 ring-amber-200";
  } else if (isSelected) {
    borderCls = "border-primary"; bgCls = "bg-blue-50"; shadow = "shadow-lg ring-2 ring-primary/30";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={readOnly}
      className={`relative rounded-2xl border-2 ${borderCls} ${bgCls} ${shadow} px-3.5 py-3.5 flex flex-col items-center gap-1.5 min-w-[88px] max-w-[100px] transition-all ${readOnly ? "cursor-default" : "cursor-pointer hover:scale-105 active:scale-100"}`}
    >
      {/* index top-right */}
      <span className="absolute top-2 right-2 text-[9px] font-bold text-slate-400/80">#{index + 1}</span>

      {/* status top-left */}
      {isConfirmed && <span className="absolute top-2 left-2 text-[10px] text-emerald-500 font-bold">✓</span>}
      {isDraft     && <span className="absolute top-2 left-2 text-[10px] text-amber-500 font-bold">~</span>}
      {isSelected && !isAssigned && <span className="absolute top-2 left-2 text-[10px] text-primary font-bold animate-pulse">●</span>}

      {/* Purpose icon circle */}
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${gc.border} ${gc.activeBg} mt-1`}>
        <Icon className={`w-5 h-5 ${gc.text}`} />
      </div>

      {/* People dots */}
      <div className="flex items-center gap-1">
        {Array.from({ length: Math.min(req.people_count || 1, 4) }).map((_, i) => (
          <span key={i} className={`w-2 h-2 rounded-full ${gc.dot}`} />
        ))}
      </div>

      {/* Gender */}
      <span className={`text-[11px] font-bold ${gc.text} leading-none`}>{gc.label}</span>

      {/* Purpose */}
      <span className="text-[10px] text-slate-500 leading-none">{pc.label}</span>

      {/* Count */}
      <span className={`text-xs font-semibold ${gc.text}`}>{req.people_count} איש</span>

      {/* Assigned tent badge */}
      {isAssigned ? (
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border leading-none ${
          isConfirmed ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-amber-100 text-amber-700 border-amber-300"
        }`}>
          אוהל {assignedTentCode}
        </span>
      ) : (
        <span className={`text-[10px] leading-none ${isSelected ? "text-primary font-semibold" : "text-slate-400"}`}>
          {isSelected ? "← בחר אוהל" : "לא שויך"}
        </span>
      )}
      {/* Show actual allocated pax if different from requested */}
      {isAssigned && assignedActualPax != null && assignedActualPax !== req.people_count && (
        <span className="text-[9px] text-slate-500 leading-none">(נבחרו בפועל: {assignedActualPax})</span>
      )}
      {isConfirmed && (
        <span className="text-[9px] text-emerald-600 flex items-center gap-0.5 opacity-80">
          {!readOnly && <Pencil className="w-2 h-2" />} {readOnly || editLocked ? "לצפייה בלבד" : "ערוך כמות"}
        </span>
      )}
    </button>
  );
}

// ── VIP Tent Card ─────────────────────────────────────────────────────────────

function VipTentCard({ tent, isOccupiedByOther, myAllocForTent, isSelecting, isSelectedByAnotherReq, onClick, readOnly = false }) {
  const isAssigned  = !!myAllocForTent;
  const isConfirmed = myAllocForTent?.status === "CONFIRMED";
  const gc          = myAllocForTent ? getGenderCfg(myAllocForTent.gender_group) : null;

  const isClickable = isSelecting && !isOccupiedByOther && !isConfirmed;
  const isEditableConfirmed = isConfirmed && !isSelecting;

  let borderCls = "border-slate-200";
  let bgCls     = "bg-white";
  let shadow    = "shadow-sm";
  let opacity   = "";

  if (isConfirmed) {
    borderCls = "border-emerald-400"; bgCls = "bg-emerald-50"; shadow = "shadow-md";
  } else if (isAssigned) {
    borderCls = "border-amber-400"; bgCls = "bg-amber-50"; shadow = "shadow-md";
  } else if (isOccupiedByOther) {
    borderCls = "border-red-200"; bgCls = "bg-red-50/80"; opacity = "opacity-50";
  } else if (isSelecting) {
    borderCls = "border-primary/40"; bgCls = "bg-blue-50/60"; shadow = "shadow-md";
  }

  return (
    <button
      type="button"
      disabled={readOnly || isOccupiedByOther || (!isSelecting && !isAssigned && !isConfirmed)}
      onClick={onClick}
      className={`rounded-xl border-2 ${borderCls} ${bgCls} ${shadow} ${opacity} px-2.5 py-3 flex flex-col items-center gap-1 min-w-[60px] transition-all relative
        ${!readOnly && (isClickable || (isAssigned && !isConfirmed) || isEditableConfirmed) ? "cursor-pointer hover:scale-105 active:scale-100" : "cursor-default"}`}
    >
      {isEditableConfirmed && (
        <span className="absolute top-1 left-1">
          <Pencil className="w-2.5 h-2.5 text-emerald-500 opacity-70" />
        </span>
      )}
      <span className="font-bold text-sm text-slate-700">{tent.code}</span>
      <span className="text-[10px] text-slate-400">עד 4🛏</span>

      {isConfirmed && gc && (
        <>
          <span className={`text-[9px] font-bold ${gc.text}`}>✓ {gc.label}</span>
          <span className={`text-xs font-bold ${gc.text}`}>{myAllocForTent.pax ?? myAllocForTent.allocated_pax ?? "?"}/{tent.capacity}</span>
        </>
      )}
      {isAssigned && !isConfirmed && gc && (
        <span className={`text-[9px] font-bold ${gc.text}`}>~{gc.label}</span>
      )}
      {isOccupiedByOther && (
        <span className="text-[9px] text-red-500 font-semibold">תפוס</span>
      )}
      {!isAssigned && !isOccupiedByOther && isSelecting && (
        <span className="text-[9px] text-primary font-semibold">בחר</span>
      )}
      {tent.is_accessible && <span className="text-[9px]">♿</span>}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function VipAllocationPanel({
  vipRows,
  vipTents,
  vipNeighborhoodId,
  conflictMap,
  myAllocations,
  profile,
  groupId,
  onInvalidate,
  isMultiPeriod = false,
  canUseMultiPeriod = false,
  logicalAssignments = [],
  group,
  readOnly = false,
}) {
  const [selectedReqIndex, setSelectedReqIndex] = useState(null);
  // dialogTarget: { reqIndex, tent } — open the assignment dialog
  const [dialogTarget, setDialogTarget] = useState(null);
  // paxEditTarget: { allocation, tent } — open the confirmed pax-edit dialog
  const [paxEditTarget, setPaxEditTarget] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);
  const [confirmDiagnostics, setConfirmDiagnostics] = useState(null);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const isActiveContinuous = !isMultiPeriod && group?.stay_mode === "CONTINUOUS" && group.arrival_date <= today && today < group.departure_date;

  // ── Persisted allocation maps ──────────────────────────────────────────────
  const myActiveVipAllocs = useMemo(
    () => isMultiPeriod
      ? getLogicalVipAllocations(readOnly ? myAllocations.filter(a => a.status !== "CANCELLED") : actionableSleepingRows(myAllocations)).filter(a => vipTents.some(t => t.id === a.tent_id))
      : myAllocations.filter(a => a.status !== "CANCELLED" && vipTents.some(t => t.id === a.tent_id) && (!isActiveContinuous || a.departure_date > today)),
    [myAllocations, vipTents, isMultiPeriod, isActiveContinuous, today, readOnly]
  );
  const periodizedAssignments = useMemo(
    () => logicalAssignments.filter(item => !item.inconsistent).map(toSleepingAssignmentPrototype),
    [logicalAssignments]
  );

  // reqIndex → persisted alloc (via __vip_req_N__ in notes)
  const vipMarkerCollisions = useMemo(() => {
    const counts = {};
    myActiveVipAllocs.forEach(a => { counts[a.requirement_index] = (counts[a.requirement_index] || 0) + 1; });
    return Object.entries(counts).filter(([, count]) => count > 1).map(([index]) => Number(index));
  }, [myActiveVipAllocs]);

  const persistedReqToAlloc = useMemo(() => {
    const map = {};
    myActiveVipAllocs.forEach(a => {
      const m = (a.notes || "").match(/__vip_req_(\d+)__/);
      if (m && map[Number(m[1])] == null) map[Number(m[1])] = a;
    });
    return map;
  }, [myActiveVipAllocs]);

  const tentCodeById = useMemo(() => {
    const map = {};
    vipTents.forEach(t => { map[t.id] = t.code; });
    return map;
  }, [vipTents]);

  // tentId → { tentId, tentCode, status, gender_group, allocated_pax } for tent card display
  const tentEffectiveAlloc = useMemo(() => {
    const map = {};
    Object.entries(persistedReqToAlloc).forEach(([, alloc]) => {
      map[alloc.tent_id] = {
        tentId: alloc.tent_id,
        tentCode: tentCodeById[alloc.tent_id] || "?",
        status: alloc.status,
        gender_group: alloc.gender_group,
        allocated_pax: alloc.allocated_pax,
      };
    });
    return map;
  }, [persistedReqToAlloc, tentCodeById]);

  // ── Derived status ─────────────────────────────────────────────────────────
  const hasDraftAllocs = myActiveVipAllocs.some(a => a.status === "DRAFT");
  const hasConflicts   = myActiveVipAllocs.some(a => a.status === "DRAFT" && conflictMap[a.tent_id]);

  // VIP totals: requested (from vipRows) vs allocated (from active allocs)
  const totalRequestedVipPax = vipRows.reduce((s, r) => s + (Number(r.people_count) || 0), 0);
  const totalAllocatedVipPax = myActiveVipAllocs.reduce((s, a) => s + (Number(a.allocated_pax) || 0), 0);
  const totalRemainingVipPax = totalRequestedVipPax - totalAllocatedVipPax;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleReqClick = (index) => {
    if (readOnly) return;
    if (vipMarkerCollisions.includes(index)) {
      setServerErrors([`דרישת VIP #${index + 1} מקושרת ליותר משיבוץ לוגי אחד. יש לשחרר את כל השיבוץ וליצור תכנית חדשה.`]);
      return;
    }
    const alloc = persistedReqToAlloc[index];

    // Confirmed MULTI_PERIOD series cannot be edited row-by-row.
    if (alloc?.status === "CONFIRMED") {
      const tent = vipTents.find(t => t.id === alloc.tent_id);
      if (isMultiPeriod && tent) {
        setDialogTarget({ reqIndex: index, tent });
      } else if (tent) {
        setPaxEditTarget({ allocation: alloc, tent });
      }
      return;
    }

    if (selectedReqIndex === index) {
      setSelectedReqIndex(null); // deselect
      return;
    }

    // If already assigned (draft) — open dialog directly for edit
    if (alloc) {
      const tent = vipTents.find(t => t.id === alloc.tent_id);
      if (tent) {
        setDialogTarget({ reqIndex: index, tent });
        setSelectedReqIndex(null);
        return;
      }
    }

    setSelectedReqIndex(index);
  };

  const handleActiveLocationChange = (index) => {
    if (vipMarkerCollisions.includes(index)) {
      setServerErrors([`דרישת VIP #${index + 1} מקושרת ליותר משיבוץ לוגי אחד. לא ניתן לשנות מקום.`]);
      return;
    }
    setSelectedReqIndex(index);
  };

  const handleTentClick = (tent) => {
    if (readOnly) return;
    if (selectedReqIndex === null) {
      // If tent is assigned by me, open edit dialog
      const assignedReqIndex = Object.entries(persistedReqToAlloc).find(
        ([, a]) => a.tent_id === tent.id
      )?.[0];
      if (assignedReqIndex !== undefined) {
        const alloc = persistedReqToAlloc[Number(assignedReqIndex)];
        if (alloc?.status === "CONFIRMED" && !isMultiPeriod) {
          // Confirmed CONTINUOUS tent clicked → open pax-edit dialog
          setPaxEditTarget({ allocation: alloc, tent });
        } else {
          setDialogTarget({ reqIndex: Number(assignedReqIndex), tent });
        }
      }
      return;
    }

    // Open dialog to confirm assignment
    setDialogTarget({ reqIndex: selectedReqIndex, tent });
    setSelectedReqIndex(null);
  };

  const handleDialogSaved = () => {
    setDialogTarget(null);
    onInvalidate();
  };

  const handleDialogReleased = () => {
    setDialogTarget(null);
    onInvalidate();
  };

  const handleConfirmAll = async () => {
    const draftIds = myActiveVipAllocs.filter(a => a.status === "DRAFT").flatMap(a =>
      isMultiPeriod ? a.period_rows.map(row => row.id) : [a.id]
    );
    if (!draftIds.length) { toast.error("אין טיוטות לאישור"); return; }
    setConfirming(true);
    setServerErrors([]);
    setConfirmDiagnostics(null);
    try {
      const confirmEndpoint = isMultiPeriod ? "confirmSleepingAllocationsCurrent" : "confirmSleepingAllocations";
      const res = await base44.functions.invoke(confirmEndpoint, {
        group_id: groupId,
        draft_allocation_ids: draftIds,
      });
      if (res.data?.success) {
        toast.success(isMultiPeriod
          ? `${myActiveVipAllocs.filter(a => a.status === "DRAFT").length} שיבוצי VIP לוגיים אושרו ✓`
          : `${res.data.confirmed_count} הקצאות VIP אושרו ✓`);
        onInvalidate();
      } else {
        const responseErrors = res.data?.errors;
        const visibleError = res.data?.error
          || (typeof responseErrors === "string" ? responseErrors : null)
          || (Array.isArray(responseErrors) && responseErrors.length ? responseErrors.join(" • ") : null)
          || "שגיאה לא ידועה";
        setServerErrors([visibleError]);
        setConfirmDiagnostics(res.data || {});
      }
    } catch (err) {
      console.error("[VipAllocationPanel] handleConfirmAll error:", err);
      const responseData = err?.response?.data || {};
      setServerErrors([responseData.error || err?.message || "שגיאה באישור ההקצאות — נסה שוב"]);
      setConfirmDiagnostics(responseData);
    } finally {
      setConfirming(false);
    }
  };

  // ── Early exit ─────────────────────────────────────────────────────────────
  if (!vipRows.length) {
    return <p className="text-xs text-slate-400 italic py-2">לא הוגדרו דרישות VIP לקבוצה זו.</p>;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5" dir="rtl">

      {/* Step instruction */}
      {readOnly ? (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-[11px] text-slate-500">שיבוצי VIP בתקופה זו מוצגים לצפייה בלבד.</div>
      ) : selectedReqIndex !== null ? (
        <div className="bg-primary/8 border border-primary/25 rounded-xl px-4 py-2.5 flex items-center gap-3 text-sm text-primary font-medium shadow-sm">
          <span className="text-base">👆</span>
          <span>בחרת דרישה #{selectedReqIndex + 1} — כעת לחץ על אוהל פנוי</span>
          <button type="button" onClick={() => setSelectedReqIndex(null)} className="mr-auto text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-600">כיצד לשבץ:</span>
          {" "}לחץ על דרישה ← בחר אוהל ← אשר בחלון
        </div>
      )}

      {/* VIP Totals banner */}
      <div className={`rounded-xl border px-4 py-2.5 flex flex-wrap items-center gap-4 text-sm ${
        totalRemainingVipPax < 0
          ? "bg-red-50 border-red-300"
          : totalRemainingVipPax === 0
            ? "bg-emerald-50 border-emerald-300"
            : "bg-amber-50 border-amber-200"
      }`}>
        <span className="text-xs text-slate-500 font-semibold">סה״כ VIP:</span>
        <span className="text-xs">נדרש: <strong>{totalRequestedVipPax}</strong></span>
        <span className="text-xs">שובצו: <strong className={totalAllocatedVipPax > 0 ? "text-primary" : ""}>{totalAllocatedVipPax}</strong></span>
        {totalRemainingVipPax > 0 && (
          <span className="text-xs font-semibold text-amber-700">נותרו לשיבוץ: {totalRemainingVipPax} אנשי VIP</span>
        )}
        {totalRemainingVipPax === 0 && totalRequestedVipPax > 0 && (
          <span className="text-xs font-semibold text-emerald-700">✓ כל אנשי ה-VIP שובצו</span>
        )}
        {totalRemainingVipPax < 0 && (
          <span className="text-xs font-semibold text-red-700">⚠ שובצו יותר אנשים ממה שנדרש!</span>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

        {/* LEFT: Requirement cards */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">דרישות ({vipRows.length})</p>
          <div className="flex flex-wrap gap-3">
            {vipRows.map((req, i) => {
              const alloc = persistedReqToAlloc[i];
              const tentCode = alloc ? tentCodeById[alloc.tent_id] || "?" : null;
              return (
                <div key={i} className="flex flex-col items-center gap-1">
                  <VipReqCard
                    req={req}
                    index={i}
                    assignedTentCode={tentCode}
                    assignedStatus={alloc?.status || null}
                    assignedActualPax={alloc?.allocated_pax ?? null}
                    isSelected={selectedReqIndex === i}
                    onClick={() => handleReqClick(i)}
                    editLocked={isMultiPeriod}
                    readOnly={readOnly}
                  />
                  {isActiveContinuous && alloc?.status === "CONFIRMED" && (
                    <button type="button" onClick={() => handleActiveLocationChange(i)} className="text-[10px] font-semibold text-primary hover:underline">
                      שנה אוהל החל מתאריך
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Tent grid */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            אוהלי VIP
            {selectedReqIndex !== null && <span className="text-primary normal-case mr-1.5">← לחץ לשיוך</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {[...vipTents].sort((a, b) => {
              const na = Number(String(a.code || "").match(/\d+/)?.[0] || 0);
              const nb = Number(String(b.code || "").match(/\d+/)?.[0] || 0);
              return nb - na; // descending: 89, 88, 87...
            }).map(tent => {
              // A tent occupied by OTHER group (not me) in conflicting dates
              const occupiedByOther = !!conflictMap[tent.id];
              // My effective alloc for this tent
              const myAllocForTent = tentEffectiveAlloc[tent.id] || null;
              // Tent is "mine" so override the occupied-by-other flag
              const isOccupiedByOther = occupiedByOther && !myAllocForTent;

              return (
                <VipTentCard
                  key={tent.id}
                  tent={tent}
                  isOccupiedByOther={isOccupiedByOther}
                  myAllocForTent={myAllocForTent}
                  isSelecting={selectedReqIndex !== null}
                  onClick={() => handleTentClick(tent)}
                  readOnly={readOnly}
                />
              );
            })}
          </div>
          {vipTents.length === 0 && <p className="text-xs text-slate-400">לא נמצאו אוהלי VIP במלאי.</p>}
        </div>
      </div>

      {vipMarkerCollisions.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 text-xs text-red-700">
          נמצאה זהות דרישת VIP כפולה בשיבוצים לוגיים שונים. פעולות שינוי חסומות.
        </div>
      )}

      {/* Error display */}
      {serverErrors.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> שגיאות:
          </p>
          {serverErrors.map((e, i) => <p key={i} className="text-xs text-red-600">• {e}</p>)}
          {confirmDiagnostics && (
            <div className="mt-2 border-t border-red-200 pt-2 text-[10px] leading-4 text-red-700" dir="ltr">
              <p>endpoint: {isMultiPeriod ? "confirmSleepingAllocationsCurrent" : "confirmSleepingAllocations"}</p>
              <p>runtime_build: {confirmDiagnostics.runtime_build ?? "—"}</p>
              <p>success: {String(confirmDiagnostics.success ?? "—")}</p>
              <p>error: {confirmDiagnostics.error ?? "—"}</p>
              <p>errors: {Array.isArray(confirmDiagnostics.errors) ? confirmDiagnostics.errors.join(" | ") : (confirmDiagnostics.errors ?? "—")}</p>
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      {!readOnly && (hasDraftAllocs || myActiveVipAllocs.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          {hasDraftAllocs && (
            <Button
              size="sm"
              onClick={handleConfirmAll}
              disabled={confirming || hasConflicts}
              className="gap-1.5 bg-emerald-700 hover:bg-emerald-800"
            >
              <ShieldCheck className="w-4 h-4" />
              {confirming ? "מאשר..." : `אשר הקצאות VIP (${myActiveVipAllocs.filter(a => a.status === "DRAFT").length})`}
            </Button>
          )}
          {hasConflicts && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> יש קונפליקטים — לא ניתן לאשר
            </p>
          )}
          {!hasDraftAllocs && myActiveVipAllocs.length > 0 && (
            <span className="text-xs text-emerald-600 flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" /> כל ההקצאות אושרו
            </span>
          )}
        </div>
      )}

      {/* Assignment Dialog */}
      {!readOnly && dialogTarget && (
        <AssignmentDialog
          req={vipRows[dialogTarget.reqIndex]}
          reqIndex={dialogTarget.reqIndex}
          tent={dialogTarget.tent}
          existingAlloc={persistedReqToAlloc[dialogTarget.reqIndex] || null}
          profile={profile}
          group={group}
          groupId={groupId}
          neighborhoodId={vipNeighborhoodId}
          onSaved={handleDialogSaved}
          onReleased={handleDialogReleased}
          onClose={() => setDialogTarget(null)}
          isMultiPeriod={isMultiPeriod}
          canUseMultiPeriod={canUseMultiPeriod}
          periodizedAssignments={periodizedAssignments}
        />
      )}

      {/* Confirmed VIP Pax Edit Dialog */}
      {!readOnly && paxEditTarget && (
        <VipPaxEditDialog
          allocation={paxEditTarget.allocation}
          tent={paxEditTarget.tent}
          totalRequestedVipPax={totalRequestedVipPax}
          totalAllocatedVipPax={totalAllocatedVipPax}
          groupId={groupId}
          onSaved={() => { setPaxEditTarget(null); onInvalidate(); }}
          onClose={() => setPaxEditTarget(null)}
        />
      )}
    </div>
  );
}