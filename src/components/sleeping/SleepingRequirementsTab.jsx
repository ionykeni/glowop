import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, CheckCircle2, Clock, AlertTriangle, Users, Star, ShieldAlert, Pencil } from "lucide-react";
import GroupFormModal from "@/components/groups/GroupFormModal";
import { toast } from "sonner";
import PeopleSummaryCard from "./PeopleSummaryCard";
import StudentTentPlanningEditor from "./StudentTentPlanningEditor";
import VipRequirementsEditor from "./VipRequirementsEditor";
import RoleGate from "@/components/RoleGate";
import { upsertReviewAlert } from "@/lib/reviewAlerts";

const VIP_TOTAL_TENTS  = 10;
const VIP_MAX_PER_TENT = 4; // allow up to 4 for operational override
const STUDENT_CAPACITY = 8;

// ── small helpers ──────────────────────────────────────────────────────────
function parseDist(json) {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function distTotal(rows) {
  return rows.reduce((s, r) => s + (r.tent_count || 0) * (r.people_per_tent || 0), 0);
}

function hasOverMaxRow(rows, max) {
  return rows.some(r => r.people_per_tent > max);
}

// ── small UI helpers ───────────────────────────────────────────────────────
function NumberInput({ label, hint, value, onChange }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      <Input
        type="number" min="0"
        value={value ?? ""}
        onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="h-8 text-sm"
      />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <textarea
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
      />
    </div>
  );
}

function SectionCard({ icon: Icon, title, color, children }) {
  return (
    <div className={`border rounded-xl p-4 space-y-3 ${color}`}>
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Icon className="w-4 h-4" /> {title}
      </h3>
      {children}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────
export default function SleepingRequirementsTab({ groupId, profile, group }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);

  const [form, setForm] = useState({
    student_sleeping_notes:      "",
    staff_sleeping_notes:        "",
    accessibility_sleeping_notes:"",
    housekeeping_sleeping_notes: "",
    sleeping_requirements_completed: false,
    staff_alt_tent_notes: "",
    staff_men_count: null,
    staff_women_count: null,
  });

  const [boysDist,    setBoysDist]  = useState([]);
  const [girlsDist,   setGirlsDist] = useState([]);
  const [vipRows,     setVipRows]   = useState([]);

  // Gender split is available only when boys+girls sum > 0 AND matches participant_count
  const boysCountVal  = Number(profile?.boys_count)  || 0;
  const girlsCountVal = Number(profile?.girls_count) || 0;
  const participantCountVal = Number(profile?.participant_count) || 0;
  const genderSumVal = boysCountVal + girlsCountVal;
  const hasGenderSplit = genderSumVal > 0 && (participantCountVal === 0 || genderSumVal === participantCountVal);

  useEffect(() => {
    if (!profile) return;
    setForm({
      student_sleeping_notes:       profile.student_sleeping_notes       ?? "",
      staff_sleeping_notes:         profile.staff_sleeping_notes         ?? "",
      accessibility_sleeping_notes: profile.accessibility_sleeping_notes ?? "",
      housekeeping_sleeping_notes:  profile.housekeeping_sleeping_notes  ?? "",
      sleeping_requirements_completed: !!profile.sleeping_requirements_completed,
      staff_alt_tent_notes: profile.staff_alt_tent_notes ?? "",
      staff_men_count:   profile.staff_men_count   ?? null,
      staff_women_count: profile.staff_women_count ?? null,
    });
    setBoysDist( parseDist(profile.boys_tent_distribution_json));
    setGirlsDist(parseDist(profile.girls_tent_distribution_json));
    setVipRows(  parseDist(profile.vip_tent_requirements_json));
  }, [profile?.id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── derived ───────────────────────────────────────────────────────────────
  // Alt tent pax = staff_count minus ALL vip rows (all person types count toward staff total)
  const liveVipStaffPeople = vipRows.reduce((s, r) => s + (Number(r.people_count) || 0), 0);
  const liveAltTentPax = (profile?.staff_count != null)
    ? Math.max(profile.staff_count - liveVipStaffPeople, 0)
    : null;

  const studentOverMax = hasOverMaxRow(boysDist, STUDENT_CAPACITY) || hasOverMaxRow(girlsDist, STUDENT_CAPACITY);

  const vipExceedsMax  = vipRows.length > VIP_TOTAL_TENTS;
  const vipOverPaxRow  = vipRows.some(r => r.people_count > VIP_MAX_PER_TENT);
  const vipMissingData = vipRows.some(r => !r.gender_group || !r.people_count);

  // Hard blocks for "סמן כמוכן"
  const hardBlocked = studentOverMax || vipExceedsMax || vipOverPaxRow || vipMissingData;

  // Derive read-only bed counts from profile (source of truth = GroupFormModal)
  const boysBedsNeeded  = profile?.boys_beds_needed  ?? profile?.boys_count  ?? null;
  const girlsBedsNeeded = profile?.girls_beds_needed ?? profile?.girls_count ?? null;
  const generalBedsNeeded = profile?.boys_beds_needed ?? profile?.participant_count ?? profile?.total_pax ?? null;

  // Soft warnings (student distribution mismatch)
  const boysDistMismatch  = hasGenderSplit && boysBedsNeeded  != null && distTotal(boysDist)  !== boysBedsNeeded;
  const girlsDistMismatch = hasGenderSplit && girlsBedsNeeded != null && distTotal(girlsDist) !== girlsBedsNeeded;
  const hasSoftWarnings   = boysDistMismatch || girlsDistMismatch;

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async (markComplete = null) => {
    if (!profile) { toast.error("אין פרופיל תפעולי"); return; }

    if (markComplete === true) {
      if (hardBlocked) { toast.error("יש שגיאות קריטיות — לא ניתן לסמן כמוכן"); return; }
      if (hasSoftWarnings) {
        if (!window.confirm("יש פערים בחלוקת האוהלים. האם לסמן כמוכן בכל זאת?")) return;
      }
    }

    setSaving(true);
    try {
      // Compute staff_alt_tent_pax automatically from vipRows vs staff_count
      // All vip rows count toward staff total — no distinction by person type
      const totalVipStaffPeople = vipRows.reduce((s, r) => s + (Number(r.people_count) || 0), 0);
      const staffCount = profile.staff_count ?? null;
      const computedAltPax = staffCount != null
        ? Math.max(staffCount - totalVipStaffPeople, 0)
        : null;

      // NOTE: boys_beds_needed / girls_beds_needed / general_beds_needed are intentionally
      // excluded — these are derived from GroupFormModal and must not be overwritten here.
      const payload = {
        student_sleeping_notes:       form.student_sleeping_notes,
        staff_sleeping_notes:         form.staff_sleeping_notes,
        accessibility_sleeping_notes: form.accessibility_sleeping_notes,
        housekeeping_sleeping_notes:  form.housekeeping_sleeping_notes,
        staff_alt_tent_notes:         form.staff_alt_tent_notes ?? "",
        boys_tent_distribution_json:  JSON.stringify(boysDist),
        girls_tent_distribution_json: JSON.stringify(girlsDist),
        vip_tent_requirements_json:   JSON.stringify(vipRows),
        staff_alt_tent_pax:           computedAltPax,
        staff_men_count:              form.staff_men_count,
        staff_women_count:            form.staff_women_count,
      };
      if (markComplete !== null) payload.sleeping_requirements_completed = markComplete;

      await base44.entities.OperationalGroupProfile.update(profile.id, payload);

      // Update local form state immediately so banner reacts without waiting for refetch
      if (markComplete !== null) set("sleeping_requirements_completed", markComplete);

      queryClient.invalidateQueries({ queryKey: ["operationalProfile", groupId] });

      if (markComplete === true)       toast.success("דרישות הלינה סומנו כמוכנות למשק בית ✓");
      else if (markComplete === false) toast.success("דרישות הלינה הוחזרו לעריכה");
      else                             toast.success("דרישות הלינה נשמרו");

      // ── Alert: sleeping requirements changed after allocations already exist ──
      try {
        const existingAllocs = await base44.entities.SleepingAllocation.filter({ group_id: groupId });
        const activeAllocs   = (existingAllocs || []).filter(a => a.status !== "CANCELLED");
        if (activeAllocs.length > 0) {
          const hasConfirmed = activeAllocs.some(a => a.status === "CONFIRMED");
          const msg = "דרישות הלינה השתנו לאחר שבוצע שיבוץ. יש לבדוק את השיבוץ מחדש.";
          await upsertReviewAlert(groupId, "ALLOCATION", "SLEEPING_REQUIREMENTS_CHANGED", "דרישות לינה השתנו — דורש בדיקה", msg, null, null);
          if (hasConfirmed) {
            await upsertReviewAlert(groupId, "HOUSEKEEPING", "SLEEPING_REQUIREMENTS_CHANGED", "דרישות לינה השתנו — דורש בדיקה", msg, null, null);
          }
        }
      } catch (alertErr) {
        console.warn("[SleepingRequirementsTab] Alert creation failed:", alertErr?.message);
      }
    } catch (err) {
      console.error("שגיאה בשמירת דרישות לינה:", err);
      toast.error(`שגיאה בשמירה: ${err?.message || "שגיאה לא ידועה"}`);
    } finally {
      setSaving(false);
    }
  };

  // ── guard ─────────────────────────────────────────────────────────────────
  const isDayUse = group?.group_type === 'DAY_USE';

  if (isDayUse) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center" dir="rtl">
        <div className="text-5xl">☀️</div>
        <div className="space-y-2">
          <p className="text-lg font-bold text-slate-700">פעילות יום — אין צורך בדרישות לינה</p>
          <p className="text-sm text-slate-500">קבוצה זו מוגדרת כפעילות יום.</p>
          <p className="text-sm text-slate-400">הקבוצה אינה לנה באתר ולכן אין צורך בשיבוץ אוהלים או בדרישות לינה.</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-12 text-slate-400 text-sm">
        <p>אין פרופיל תפעולי מאושר לקבוצה זו.</p>
        <p className="text-xs mt-1">יש לאשר טופס קבלה כפרופיל תפעולי תחילה.</p>
      </div>
    );
  }

  const isCompleted = form.sleeping_requirements_completed;

  return (
    <div className="space-y-5" dir="rtl">

      {/* Status banner */}
      <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${isCompleted ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
        {isCompleted
          ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          : <Clock className="w-5 h-5 text-amber-600 shrink-0" />
        }
        <div>
          <p className={`text-sm font-semibold ${isCompleted ? "text-emerald-800" : "text-amber-800"}`}>
            {isCompleted ? "דרישות לינה מוכנות למשק בית" : "ממתין לשיבוץ משק בית"}
          </p>
          <p className={`text-xs ${isCompleted ? "text-emerald-600" : "text-amber-600"}`}>
            {isCompleted
              ? "משק הבית יוכל להקצות אוהלים בהתאם לדרישות אלו"
              : "יש למלא דרישות לינה ולסמן כמוכן לפני שמשק הבית יוכל לשבץ אוהלים"
            }
          </p>
        </div>
        <RoleGate permission="MANAGE_ALLOCATION">
          <div className="mr-auto flex gap-2">
            {isCompleted ? (
              <Button size="sm" variant="outline" onClick={() => handleSave(false)} disabled={saving}
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 text-xs">
                חזור לעריכה
              </Button>
            ) : (
              <Button size="sm" onClick={() => handleSave(true)}
                disabled={saving || hardBlocked}
                className="bg-emerald-700 hover:bg-emerald-800 text-xs gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> סמן כמוכן למשק בית
              </Button>
            )}
          </div>
        </RoleGate>
      </div>

      {/* Hard-block warnings */}
      {hardBlocked && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" /> שגיאות קריטיות — חסום סימון כמוכן
          </p>
          {studentOverMax  && <p className="text-xs text-red-600">• יש שורת חלוקה תלמידים עם יותר מ-{STUDENT_CAPACITY} לאוהל</p>}
          {vipExceedsMax   && <p className="text-xs text-red-600">• סה"כ שורות VIP ({vipRows.length}) חורג מהמקסימום ({VIP_TOTAL_TENTS})</p>}
          {vipOverPaxRow   && <p className="text-xs text-red-600">• יש שורת VIP עם יותר מ-{VIP_MAX_PER_TENT} אנשים לאוהל (מקסימום 4 לאוהל VIP)</p>}
          {vipMissingData  && <p className="text-xs text-red-600">• יש שורת VIP עם מגדר או מספר אנשים חסר</p>}
        </div>
      )}

      {/* Part A — People summary */}
      <PeopleSummaryCard
        profile={profile}
        vipRows={vipRows}
        boysDist={boysDist}
        girlsDist={girlsDist}
        staffAltTentPax={liveAltTentPax}
        staffAltTentNotes={form.staff_alt_tent_notes}
        staffMenCount={form.staff_men_count}
        staffWomenCount={form.staff_women_count}
        onStaffMaleChange={v => set("staff_men_count", v)}
        onStaffFemaleChange={v => set("staff_women_count", v)}
      />

      {/* Part B+C+D — Students */}
      <SectionCard icon={Users} title="דרישות לינה — תלמידים / משתתפים" color="bg-blue-50/50 border-blue-200">

        {!hasGenderSplit && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ℹ️ לא הוזנה חלוקה לבנים/בנות. ניתן לבצע שיבוץ כללי לפי מספר המשתתפים.
          </div>
        )}

        {hasGenderSplit ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">מיטות נדרשות — בנים</label>
              <p className="text-[11px] text-slate-400">מהשאלון: {profile.boys_count ?? "—"}</p>
              <div className="h-8 flex items-center px-3 rounded-md border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
                {boysBedsNeeded ?? "—"}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">מיטות נדרשות — בנות</label>
              <p className="text-[11px] text-slate-400">מהשאלון: {profile.girls_count ?? "—"}</p>
              <div className="h-8 flex items-center px-3 rounded-md border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
                {girlsBedsNeeded ?? "—"}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">מיטות נדרשות — משתתפים (שיבוץ כללי)</label>
            <p className="text-[11px] text-slate-400">מהשאלון: {profile.participant_count ?? profile.total_pax ?? "—"}</p>
            <div className="h-8 flex items-center px-3 rounded-md border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
              {generalBedsNeeded ?? "—"}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowGroupEdit(true)}>
            <Pencil className="w-3.5 h-3.5" /> ערוך פרטי קבוצה
          </Button>
          <span className="text-[11px] text-slate-400">לשינוי מספרי משתתפים / בנים / בנות</span>
        </div>

        {hasGenderSplit ? (
          <>
            <StudentTentPlanningEditor
              title="חלוקת אוהלים — בנים"
              required={boysBedsNeeded}
              rows={boysDist}
              onChange={setBoysDist}
              maxPerTent={STUDENT_CAPACITY}
              color="bg-blue-50"
            />
            <StudentTentPlanningEditor
              title="חלוקת אוהלים — בנות"
              required={girlsBedsNeeded}
              rows={girlsDist}
              onChange={setGirlsDist}
              maxPerTent={STUDENT_CAPACITY}
              color="bg-pink-50"
            />
            <div className="text-[11px] text-blue-600 bg-blue-100 rounded-lg px-3 py-2">
              ℹ️ בנים ובנות ישכנו באוהלים נפרדים. משק הבית יקצה את האוהלים הספציפיים בפועל.
            </div>
          </>
        ) : (
          <StudentTentPlanningEditor
            title="חלוקת אוהלים — כללי / שיבוץ כללי"
            required={generalBedsNeeded}
            rows={boysDist}
            onChange={setBoysDist}
            maxPerTent={STUDENT_CAPACITY}
            color="bg-blue-50"
          />
        )}

        <TextArea
          label="הערות לינה — תלמידים"
          value={form.student_sleeping_notes}
          onChange={v => set("student_sleeping_notes", v)}
          placeholder="הפרדה מיוחדת, קבוצות, הגדרות..."
        />
      </SectionCard>

      {/* VIP / Staff */}
      <SectionCard icon={Star} title="דרישות לינה — צוות / VIP (אוהלי 80–89)" color="bg-purple-50/50 border-purple-200">
        {/* Show staff sleeping info submitted by client */}
        {(() => {
          const tentNotes = profile?.tent_distribution_notes;
          if (!tentNotes) return null;
          let parsed = {};
          try { parsed = JSON.parse(tentNotes); } catch { return null; }
          const detail = parsed.staff_detail_notes?.trim();
          const instructions = parsed.staff_sleeping_notes?.trim();
          if (!detail && !instructions) return null;
          return (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2 text-xs">
              <p className="font-semibold text-blue-800">📋 מידע שנמסר ע״י הלקוח (מהשאלון)</p>
              {detail && (
                <div>
                  <p className="text-blue-600 font-medium mb-0.5">פירוט צוות שישן במקום:</p>
                  <p className="text-slate-700 whitespace-pre-wrap bg-white rounded-lg border border-blue-100 px-3 py-2">{detail}</p>
                </div>
              )}
              {instructions && (
                <div>
                  <p className="text-blue-600 font-medium mb-0.5">הנחיות מיוחדות ללינה:</p>
                  <p className="text-slate-700 whitespace-pre-wrap bg-white rounded-lg border border-blue-100 px-3 py-2">{instructions}</p>
                </div>
              )}
            </div>
          );
        })()}
        <VipRequirementsEditor
          rows={vipRows}
          onChange={setVipRows}
          staffTotal={profile.staff_count ?? null}
          driversTotal={(profile.drivers_men_count != null || profile.drivers_women_count != null)
            ? (profile.drivers_men_count ?? 0) + (profile.drivers_women_count ?? 0)
            : null}
          altTentPax={liveAltTentPax}
          altTentNotes={form.staff_alt_tent_notes}
          onAltTentNotesChange={v => set("staff_alt_tent_notes", v)}
          staffMenCount={form.staff_men_count}
          staffWomenCount={form.staff_women_count}
        />
        <TextArea
          label="הערות לינה — צוות / VIP"
          value={form.staff_sleeping_notes}
          onChange={v => set("staff_sleeping_notes", v)}
          placeholder="העדפות מיוחדות, צרכים רפואיים..."
        />
      </SectionCard>

      {/* Accessibility & general */}
      <SectionCard icon={AlertTriangle} title="נגישות והערות כלליות" color="bg-amber-50/50 border-amber-200">
        <TextArea
          label="צרכי נגישות (לינה)"
          value={form.accessibility_sleeping_notes}
          onChange={v => set("accessibility_sleeping_notes", v)}
          placeholder="כסא גלגלים, קושי בטיפוס, מיטה נמוכה..."
        />
        <TextArea
          label="הערות כלליות למשק בית"
          value={form.housekeeping_sleeping_notes}
          onChange={v => set("housekeeping_sleeping_notes", v)}
          placeholder="כל הערה נוספת לצוות משק הבית..."
        />
      </SectionCard>

      {/* Save */}
      <RoleGate permission="MANAGE_ALLOCATION">
        <div className="flex justify-end pt-2">
          <Button onClick={() => handleSave(null)} disabled={saving} className="gap-1.5">
            <Save className="w-4 h-4" />
            {saving ? "שומר..." : "שמור דרישות"}
          </Button>
        </div>
      </RoleGate>

      {showGroupEdit && group && (
        <GroupFormModal
          group={group}
          onClose={() => setShowGroupEdit(false)}
          onSaved={() => {
            setShowGroupEdit(false);
            queryClient.invalidateQueries({ queryKey: ["operationalProfile", groupId] });
          }}
        />
      )}
    </div>
  );
}