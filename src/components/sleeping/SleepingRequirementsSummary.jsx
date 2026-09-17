/**
 * Displays sleeping requirements and allocation progress.
 * Single source of truth: computeAllocationCounts.
 *
 * Two buckets:
 *   1. Students (boys / girls)
 *   2. Staff / VIP / adults (one bucket — VIP + alt tent are WHERE they sleep, not extra people)
 */
import { computeAllocationCounts } from "@/lib/allocationCounts";
import { groupLogicalSleepingAssignments } from "@/components/sleeping/logicalSleepingView";

const Counter = ({ label, required, allocated }) => {
  const remaining = required - allocated;
  const isOver = remaining < 0;
  const isComplete = remaining === 0;

  return (
    <div className={`rounded-lg border bg-white px-3 py-2.5 ${isComplete ? "border-emerald-200" : "border-amber-200"}`} dir="rtl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isComplete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {isComplete ? "הושלם" : isOver ? `חריגה +${Math.abs(remaining)}` : `נותרו ${remaining}`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <span className="text-slate-500">נדרש <strong className="text-slate-800">{required}</strong></span>
        <span className="text-slate-500">שובץ <strong className="text-slate-800">{allocated}</strong></span>
      </div>
    </div>
  );
};

export default function SleepingRequirementsSummary({ profile, allocations, nhoodReservations = [], neighborhoods = [] }) {
  if (!profile) return null;

  const counts = computeAllocationCounts(allocations, profile);

  const hasStudents = counts.studentRequired > 0;
  const hasStaff    = counts.staffRequired > 0;
  const hasAny      = counts.totalRequired > 0;

  // Per-gender breakdown for student display
  const activeStudentAllocs = groupLogicalSleepingAssignments(
    (allocations || []).filter(a => a.status !== "CANCELLED" && a.allocation_type === "STUDENT")
  ).logical_assignments.filter(a => !a.inconsistent);
  const allocatedBoys  = activeStudentAllocs.filter(a => a.gender_group === "BOYS").reduce((s, a) => s + (a.logical_allocated_pax || 0), 0);
  const allocatedGirls = activeStudentAllocs.filter(a => a.gender_group === "GIRLS").reduce((s, a) => s + (a.logical_allocated_pax || 0), 0);
  const allocatedMixed = activeStudentAllocs.filter(a => a.gender_group === "MIXED").reduce((s, a) => s + (a.logical_allocated_pax || 0), 0);

  const boysRequired  = Number(profile.boys_beds_needed  ?? profile.boys_count  ?? 0) || 0;
  const girlsRequired = Number(profile.girls_beds_needed ?? profile.girls_count ?? 0) || 0;
  const hasBothGenders = boysRequired > 0 && girlsRequired > 0;

  const activeNhoods = Object.values(Object.fromEntries(
    (nhoodReservations || []).filter(r => r.status === "ACTIVE").map(r => [r.neighborhood_id, r])
  ));

  // Over-allocation warning
  const overAllocated = counts.totalAllocated > counts.totalRequired && counts.totalRequired > 0;
  const overCount = counts.totalAllocated - counts.totalRequired;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">דרישות מול שיבוץ</h3>
        {hasAny && <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${overAllocated ? "bg-amber-50 text-amber-700" : counts.isComplete ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{overAllocated ? "חריגה בשיבוץ" : counts.isComplete ? "השיבוץ הושלם" : counts.totalAllocated > 0 ? "שיבוץ חלקי" : "ממתין לשיבוץ"}</span>}
      </div>

      {/* ── Overall status banner ─────────────────────────────────────────── */}
      {hasAny && (
        <div className={`grid grid-cols-3 overflow-hidden rounded-lg border ${overAllocated ? "border-amber-300" : counts.isComplete ? "border-emerald-200" : "border-slate-200"}`}>
          <div className="bg-slate-50 px-3 py-2 text-center"><p className="text-[10px] text-slate-500">נדרש</p><p className="text-lg font-bold text-slate-800">{counts.totalRequired}</p></div>
          <div className="border-x border-slate-200 bg-white px-3 py-2 text-center"><p className="text-[10px] text-slate-500">שובץ</p><p className="text-lg font-bold text-slate-800">{counts.totalAllocated}</p></div>
          <div className={`px-3 py-2 text-center ${counts.totalRemaining > 0 || overAllocated ? "bg-amber-50" : "bg-emerald-50"}`}><p className="text-[10px] text-slate-500">{overAllocated ? "חריגה" : "נותרו"}</p><p className={`text-lg font-bold ${counts.totalRemaining > 0 || overAllocated ? "text-amber-700" : "text-emerald-700"}`}>{overAllocated ? `+${overCount}` : counts.totalRemaining}</p></div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {hasStudents && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-500">חניכים</p>
            {hasBothGenders ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Counter label="בנים" required={boysRequired} allocated={allocatedBoys} />
                <Counter label="בנות" required={girlsRequired} allocated={allocatedGirls} />
                <Counter label="סה״כ חניכים" required={counts.studentRequired} allocated={counts.studentAllocated} />
              </div>
            ) : boysRequired > 0 ? <Counter label="בנים" required={boysRequired} allocated={allocatedBoys} /> : <Counter label="בנות" required={girlsRequired} allocated={allocatedGirls} />}
            {hasBothGenders && allocatedMixed > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{allocatedMixed} אנשים שובצו כמעורב — מומלץ לסווג כבנים או בנות לספירה מדויקת.</div>}
          </div>
        )}
        {hasStaff && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-500">צוות / מלווים / VIP</p>
            <Counter label="צוות" required={counts.staffRequired} allocated={counts.staffAllocated} />
            {(counts.vipAllocated > 0 || counts.altTentAllocated > 0 || counts.otherStaffAllocated > 0) && <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[10px] text-slate-500">{counts.vipAllocated > 0 && <span>VIP: {counts.vipPaxVariesByPeriod ? "משתנה לפי תקופה" : counts.vipAllocated} · {counts.vipTentCount} אוהלים</span>}{counts.altTentAllocated > 0 && <span>אוהל חילופי: {counts.altTentAllocated} · {counts.altTentCount} אוהלים</span>}{counts.otherStaffAllocated > 0 && <span>צוות אחר: {counts.otherStaffAllocated}</span>}</div>}
          </div>
        )}
      </div>

      {/* ── No requirements defined ──────────────────────────────────────── */}
      {!hasAny && profile.is_sleeping_group && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          ℹ️ דרישות לינה טרם הוגדרו — יש להשלים בטאב דרישות לינה.
        </div>
      )}

      {/* ── Neighbourhood summary ─────────────────────────────────────────── */}
      {activeNhoods.length > 0 && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          <span className="font-medium text-slate-600">שכונות שנבחרו: </span>
          {activeNhoods.map((r, i) => {
            const nName = neighborhoods.find(n => n.id === r.neighborhood_id)?.name || r.neighborhood_id;
            return (
              <span key={r.id}>
                {i > 0 && ", "}
                <span className="text-slate-700 font-medium">{nName}</span>
                {" "}({r.planned_tents || "?"} אוהלים
                {r.gender_group !== "MIXED" ? ` · ${r.gender_group === "BOYS" ? "בנים" : "בנות"}` : " · מעורב"})
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}