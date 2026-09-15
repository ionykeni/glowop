import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, CheckCircle2, ChevronDown, ChevronUp, Plus, X, LayoutGrid, AlertTriangle, Users } from "lucide-react";
import TentDistributionEditor from "./TentDistributionEditor";
import AutoAllocationButton from "./AutoAllocationButton";
import { releaseSleepingNeighborhood } from '@/components/sleeping/seriesActions';
import { toast } from 'sonner';
import RoleGate from "@/components/RoleGate";
import TemporalScopeBadge from "./TemporalScopeBadge";

const GENDER_OPTIONS = [
  { value: "BOYS",  label: "בנים 👦" },
  { value: "GIRLS", label: "בנות 👧" },
  { value: "MIXED", label: "מעורב / כללי 👥" },
];

/**
 * One student neighborhood row.
 *
 * Props:
 *  neighborhood        - Neighborhood record
 *  tents               - Tent[] inside this neighborhood (working only)
 *  lockByThisGroup     - NeighborhoodReservation | null  (ACTIVE lock owned by current group)
 *  lockByOtherGroup    - { group_name, gender_group } | null
 *  arrivalDate         - string
 *  departureDate       - string
 *  groupId             - string
 *  profileId           - string
 *  onReserve(payload)  - create/update reservation
 *  onRelease(reservationId) - cancel reservation
 */
export default function StudentNeighborhoodPanel({
  neighborhood,
  tents,
  lockByThisGroup,
  lockByOtherGroup,
  arrivalDate,
  departureDate,
  groupId,
  profileId,
  onReserve,
  onRelease,
  saving,
  allConfirmedAllocs = [],
  allActiveAllocs = [],
  onSaved,
  defaultGenderGroup = "BOYS",
  profile = null,
  existingGroupAllocs = [],
  occupiedTents = [],
  isMultiPeriod = false,
  canUseMultiPeriod = false,
  logicalAssignments = [],
  seriesValidation = null,
  activeStayPeriods = [],
  readOnly = false,
  allowPeriodPaxEdit = false,
  onPeriodPaxEdit,
  allowPeriodLocationEdit = false,
  onPeriodLocationEdit,
  temporalCoverage = null,
}) {
  const [open, setOpen] = useState(false);
  const [showDistribution, setShowDistribution] = useState(false);
  const [releasingNeighborhood, setReleasingNeighborhood] = useState(false);
  const [form, setForm] = useState({
    gender_group: defaultGenderGroup,
    planned_tents: tents.length,
    notes: "",
  });
  // Shared neighborhood override state
  const [sharedAllowed, setSharedAllowed] = useState(false);
  const [sharedReason, setSharedReason] = useState("");

  const totalBeds = tents.reduce((s, t) => s + (t.capacity || 0), 0);
  const logicalNeighborhoodAssignments = logicalAssignments.filter(a => a.allocation_type === "STUDENT" && a.neighborhood_id === neighborhood.id);
  const isLockedByMe = isMultiPeriod ? logicalNeighborhoodAssignments.length > 0 : !!lockByThisGroup;
  const hasNeighborhoodConflict = !!lockByOtherGroup;
  const isLockedByOther = hasNeighborhoodConflict && !isLockedByMe;
  const blockedTentIds = new Set(allActiveAllocs
    .filter(allocation => allocation.group_id !== groupId && allocation.status !== "CANCELLED" &&
      activeStayPeriods.some(period => period.start_date < allocation.departure_date && allocation.arrival_date < period.end_date))
    .map(allocation => allocation.tent_id));
  const hasPhysicallyAvailableTent = tents.some(tent => !blockedTentIds.has(tent.id));
  const effectiveReservation = lockByThisGroup || (isMultiPeriod ? {
    gender_group: logicalNeighborhoodAssignments[0]?.gender_group || form.gender_group,
    planned_tents: logicalNeighborhoodAssignments.length || Number(form.planned_tents) || tents.length,
  } : null);
  // Is this neighborhood already shared (approved on existing reservation)?
  const isAlreadyShared = !!(lockByThisGroup?.shared_neighborhood_allowed);
  const effectiveSharedReason = sharedReason.trim() || lockByThisGroup?.shared_neighborhood_reason?.trim() || "";
  const sharedNeighborhoodIntent = (sharedAllowed || isAlreadyShared) && effectiveSharedReason ? [{
    neighborhood_id: neighborhood.id,
    shared_neighborhood_allowed: true,
    reason: effectiveSharedReason,
  }] : [];

  const handleReserve = () => {
    // If neighborhood is used by another group, require conscious shared override
    if (isLockedByOther && !sharedAllowed) return;
    if (isLockedByOther && sharedAllowed && !sharedReason.trim()) return;

    const payload = {
      group_id: groupId,
      operational_group_profile_id: profileId,
      neighborhood_id: neighborhood.id,
      arrival_date: arrivalDate,
      departure_date: departureDate,
      gender_group: form.gender_group,
      planned_tents: Number(form.planned_tents) || tents.length,
      notes: form.notes,
      status: "ACTIVE",
      source: "allocation",
    };
    if (sharedAllowed && sharedReason.trim()) {
      payload.shared_neighborhood_allowed = true;
      payload.shared_neighborhood_reason = sharedReason.trim();
    }
    onReserve(payload);
    setSharedAllowed(false);
    setSharedReason("");
    setOpen(false);
  };

  const handleRelease = async () => {
    if (isMultiPeriod) {
      if (!window.confirm(`לשחרר את השיבוצים הנוכחיים והעתידיים של ${neighborhood.name}?\nשיבוצים היסטוריים ושכונות אחרות יישמרו.`)) return;
      setReleasingNeighborhood(true);
      try {
        await releaseSleepingNeighborhood(groupId, neighborhood.id);
        onSaved?.();
        toast.success(`${neighborhood.name} שוחררה; ההיסטוריה ושכונות אחרות נשמרו`);
      } catch (error) { toast.error(error.message); }
      finally { setReleasingNeighborhood(false); }
      return;
    }
    if (!window.confirm("לשחרר שכונה זו מהקצאת הקבוצה?")) return;
    onRelease(lockByThisGroup.id);
  };

  // ── card color ─────────────────────────────────────────────────────────────
  let borderClass = "border-slate-200";
  let bgClass = "bg-white";
  if (isLockedByMe && isAlreadyShared) { borderClass = "border-amber-300"; bgClass = "bg-amber-50"; }
  else if (isLockedByMe) { borderClass = "border-emerald-300"; bgClass = "bg-emerald-50"; }
  else if (isLockedByOther) { borderClass = "border-amber-300"; bgClass = "bg-amber-50"; }

  return (
    <div className={`border rounded-xl overflow-hidden ${borderClass} ${bgClass}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-800">{neighborhood.name}</span>
            <TemporalScopeBadge scope={temporalCoverage?.scope} />
            <span className="text-xs text-slate-400">{tents.length} אוהלים · {totalBeds} מיטות</span>

            {isLockedByMe && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-full px-2 py-0.5">
                <CheckCircle2 className="w-3 h-3" />
                שמורה לקבוצה ({GENDER_OPTIONS.find(g => g.value === effectiveReservation.gender_group)?.label ?? effectiveReservation.gender_group})
                · {effectiveReservation.planned_tents} אוהלים מתוכננים
              </span>
            )}

            {isLockedByOther && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300 rounded-full px-2 py-0.5">
                <Users className="w-3 h-3" /> שכונה משותפת עם קבוצה נוספת — {lockByOtherGroup.group_name}
              </span>
            )}
            {isAlreadyShared && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                <Users className="w-3 h-3" /> שכונה משותפת
              </span>
            )}
          </div>

          {/* Spare tent note when reserved by me */}
          {isLockedByMe && (() => {
            const spare = tents.length - (effectiveReservation.planned_tents || tents.length);
            if (spare <= 0) return null;
            return (
              <p className="text-[10px] text-slate-500 mt-0.5">
                נותרו {spare} אוהלים שאינם בשימוש של קבוצה זו
              </p>
            );
          })()}
          {/* Tent-level occupancy by other groups (visible even without a neighborhood reservation) */}
          {occupiedTents.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {occupiedTents.map((t, i) => (
                <p key={i} className="text-[10px] text-red-600 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 shrink-0" />
                  אוהל {t.tent_name} תפוס ע״י {t.group_name} ({t.arrival_date} — {t.departure_date}, {t.pax} איש)
                </p>
              ))}
            </div>
          )}
          {/* Shared reason display */}
          {isAlreadyShared && lockByThisGroup.shared_neighborhood_reason && (
            <p className="text-[10px] text-amber-700 mt-0.5">
              סיבה: {lockByThisGroup.shared_neighborhood_reason}
            </p>
          )}
        </div>

        {/* Actions */}
        {!readOnly && (isLockedByOther || !isLockedByOther) && (
          <div className="flex items-center gap-1.5 shrink-0">
            {isLockedByMe ? (
              <>
                <AutoAllocationButton
                  neighborhood={neighborhood}
                  tents={tents}
                  profile={profile}
                  groupId={groupId}
                  profileId={profileId}
                  arrivalDate={arrivalDate}
                  departureDate={departureDate}
                  allConfirmedAllocs={allConfirmedAllocs}
                  allActiveAllocs={allActiveAllocs}
                  existingGroupAllocs={existingGroupAllocs}
                  onSaved={onSaved}
                  isMultiPeriod={isMultiPeriod}
                  canUseMultiPeriod={canUseMultiPeriod}
                  activeStayPeriods={activeStayPeriods}
                  logicalAssignments={logicalAssignments}
                  seriesValidation={seriesValidation}
                  sharedNeighborhoods={sharedNeighborhoodIntent}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                  onClick={() => setShowDistribution(true)}
                >
                  <LayoutGrid className="w-3 h-3" /> פירוט לפי אוהלים
                </Button>
                {isMultiPeriod && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
                    onClick={handleRelease}
                    disabled={saving || releasingNeighborhood}
                  >
                    <X className="w-3 h-3" /> {releasingNeighborhood ? 'משחרר...' : 'שחרור שכונה'}
                  </Button>
                )}
                {!isMultiPeriod && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                      onClick={() => setOpen(o => !o)}
                    >
                      {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      ערוך
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
                      onClick={handleRelease}
                      disabled={saving}
                    >
                      <X className="w-3 h-3" /> שחרר
                    </Button>
                  </>
                )}
              </>
            ) : isMultiPeriod ? (
              <>
                <AutoAllocationButton
                  neighborhood={neighborhood}
                  tents={tents}
                  profile={profile}
                  groupId={groupId}
                  profileId={profileId}
                  arrivalDate={arrivalDate}
                  departureDate={departureDate}
                  allConfirmedAllocs={allConfirmedAllocs}
                  allActiveAllocs={allActiveAllocs}
                  existingGroupAllocs={existingGroupAllocs}
                  onSaved={onSaved}
                  isMultiPeriod
                  canUseMultiPeriod={canUseMultiPeriod}
                  activeStayPeriods={activeStayPeriods}
                  logicalAssignments={logicalAssignments}
                  seriesValidation={seriesValidation}
                  sharedNeighborhoods={sharedNeighborhoodIntent}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setOpen(o => !o)}
                  disabled={!canUseMultiPeriod || seriesValidation?.valid === false}
                >
                  <LayoutGrid className="w-3 h-3" /> בחר שכונה ואוהלים
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className={`h-7 text-xs gap-1 ${isLockedByOther ? "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100" : ""}`}
                variant={isLockedByOther ? "outline" : "default"}
                onClick={() => setOpen(o => !o)}
              >
                {isLockedByOther ? <AlertTriangle className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                {isLockedByOther ? "שימוש משותף..." : "הוסף שכונה"}
              </Button>
            )}
          </div>
        )}
      </div>

      {!readOnly && temporalCoverage?.tents?.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-2">
          <p className="mb-1 text-[10px] font-semibold text-slate-500">אוהלים לפי תקופות</p>
          <div className="flex flex-wrap gap-1.5">{temporalCoverage.tents.map(item => <span key={item.tent_id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"><strong>אוהל {tents.find(tent => tent.id === item.tent_id)?.code || "?"}</strong><TemporalScopeBadge scope={item.scope} /></span>)}</div>
        </div>
      )}

      {readOnly && logicalNeighborhoodAssignments.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-2">
          <p className="text-[10px] font-semibold text-slate-500 mb-1">אוהלים בתקופה זו</p>
          <div className="flex flex-wrap gap-1.5">
            {logicalNeighborhoodAssignments.map(assignment => {
              const tent = tents.find(item => item.id === assignment.tent_id);
              const row = assignment.period_rows?.[0] || assignment;
              return <span key={assignment.logical_key || row.id || assignment.tent_id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">אוהל {tent?.code || "?"} · {assignment.logical_allocated_pax ?? assignment.allocated_pax ?? 0} אנשים{allowPeriodPaxEdit && <RoleGate permission="MANAGE_ALLOCATION"><button type="button" onClick={() => onPeriodPaxEdit?.(row)} className="mr-1 font-semibold text-blue-700 hover:underline">ערוך כמות</button></RoleGate>}{allowPeriodLocationEdit && <RoleGate permission="MANAGE_ALLOCATION"><button type="button" onClick={() => onPeriodLocationEdit?.(row)} className="mr-1 font-semibold text-blue-700 hover:underline">שנה אוהל</button></RoleGate>}</span>;
            })}
          </div>
        </div>
      )}

      {!readOnly && isMultiPeriod && hasNeighborhoodConflict && hasPhysicallyAvailableTent && !isAlreadyShared && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-xs text-amber-800">
            השכונה משותפת עם {lockByOtherGroup.group_name}. אישור זה עוקף רק את התנגשות השכונה; אוהל תפוס נשאר חסום.
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sharedAllowed}
              onChange={e => {
                setSharedAllowed(e.target.checked);
                if (!e.target.checked) setSharedReason("");
              }}
              className="w-4 h-4 accent-amber-600"
            />
            <span className="text-xs font-semibold text-amber-900">שימוש משותף בשכונה</span>
          </label>
          {sharedAllowed && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-amber-900">סיבת שימוש משותף *</label>
              <Textarea
                value={sharedReason}
                onChange={e => setSharedReason(e.target.value)}
                placeholder="יש לפרט את סיבת האישור"
                className="text-xs min-h-[56px] border-amber-300 focus:border-amber-500"
              />
              {!sharedReason.trim() && <p className="text-[10px] text-red-600">סיבה חובה</p>}
            </div>
          )}
        </div>
      )}

      {/* Tent distribution editor */}
      <TentDistributionEditor
        open={showDistribution}
        onClose={() => setShowDistribution(false)}
        neighborhood={neighborhood}
        tents={tents}
        reservation={effectiveReservation}
        groupId={groupId}
        profileId={profileId}
        profile={profile}
        arrivalDate={arrivalDate}
        departureDate={departureDate}
        allConfirmedAllocs={allConfirmedAllocs}
        allActiveAllocs={allActiveAllocs}
        onSaved={onSaved}
        isMultiPeriod={isMultiPeriod}
        canUseMultiPeriod={canUseMultiPeriod}
        seriesValidation={seriesValidation}
        activeStayPeriods={activeStayPeriods}
        sharedNeighborhoods={sharedNeighborhoodIntent}
      />

      {/* Expand form */}
      {!readOnly && open && (
        <div className="border-t border-slate-200 px-4 py-3 bg-white space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-600">מגדר</label>
              <Select
                value={isLockedByMe ? effectiveReservation.gender_group : form.gender_group}
                onValueChange={v => setForm(f => ({ ...f, gender_group: v }))}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-600">
                אוהלים מתוכננים (מתוך {tents.length})
              </label>
              <Input
                type="number"
                min="1"
                max={tents.length}
                value={isLockedByMe ? (effectiveReservation.planned_tents ?? tents.length) : form.planned_tents}
                onChange={e => setForm(f => ({ ...f, planned_tents: e.target.value }))}
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-600">הערות (אופציונלי)</label>
            <Input
              value={isLockedByMe ? (lockByThisGroup.notes || "") : form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="h-7 text-xs"
              placeholder="הערות..."
            />
          </div>
          {/* CONTINUOUS shared neighborhood override section */}
          {isLockedByOther && !isMultiPeriod && (
            <div className="border border-amber-300 rounded-lg bg-amber-50 px-3 py-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                שכונה זו כבר בשימוש על ידי קבוצה אחרת בתאריכים אלו.
              </p>
              <p className="text-[11px] text-amber-700">
                כדי לאפשר שימוש משותף, סמן את האפשרות למטה ורשום סיבה. האוהלים הספציפיים עדיין לא יהיו כפולים — המערכת תחסום כפל אוהלים.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sharedAllowed}
                  onChange={e => {
                    setSharedAllowed(e.target.checked);
                    if (!e.target.checked) setSharedReason("");
                  }}
                  className="w-4 h-4 accent-amber-600"
                />
                <span className="text-xs font-semibold text-amber-800">אפשר שימוש בשכונה משותפת</span>
              </label>
              {sharedAllowed && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-amber-800">סיבת אישור שכונה משותפת *</label>
                  <Textarea
                    value={sharedReason}
                    onChange={e => setSharedReason(e.target.value)}
                    placeholder="לדוגמה: הקבוצות משתמשות באוהלים שונים בלבד / אושר מול התפעול"
                    className="text-xs min-h-[56px] border-amber-300 focus:border-amber-500"
                  />
                  {!sharedReason.trim() && (
                    <p className="text-[10px] text-red-600">סיבה חובה לאישור שכונה משותפת</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setOpen(false); setSharedAllowed(false); setSharedReason(""); }}>ביטול</Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={isMultiPeriod ? () => { setOpen(false); setShowDistribution(true); } : handleReserve}
              disabled={saving || (isLockedByOther && (!sharedAllowed || !sharedReason.trim()))}
            >
              {isMultiPeriod ? "המשך לבחירת אוהלים" : isLockedByMe ? "עדכן" : "שמור שכונה"}
            </Button>
          </div>
          <p className="text-[10px] text-slate-400 text-center">
            הבלעדיות הפיזית נשמרת ברמת אוהל ותאריכים; שכונות יכולות להיות משותפות באישור
          </p>
        </div>
      )}
    </div>
  );
}