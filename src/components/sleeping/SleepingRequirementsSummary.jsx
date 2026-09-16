/**
 * Displays sleeping requirements and allocation progress.
 * Single source of truth: computeAllocationCounts.
 *
 * Two buckets:
 *   1. Students (boys / girls)
 *   2. Staff / VIP / adults (one bucket — VIP + alt tent are WHERE they sleep, not extra people)
 */
import { computeAllocationCounts } from "@/lib/allocationCounts";
import { groupLogicalSleepingAssignments } from "../../../base44/shared/logicalSleepingSeries.js";

const Counter = ({ label, required, allocated, sub = false }) => {
  const remaining = required - allocated;
  const isOver     = remaining < 0;
  const isComplete = remaining === 0;

  const containerColor = isComplete
    ? "bg-green-50 border-green-200"
    : "bg-amber-50 border-amber-200";
  const mainColor = isComplete ? "text-green-700" : "text-amber-700";

  return (
    <div className={`rounded-xl border px-3 py-3 flex flex-col gap-1.5 ${containerColor} ${sub ? "opacity-80" : ""}`} dir="rtl">
      <span className={`${sub ? "text-[10px]" : "text-xs"} font-bold text-slate-700`}>{label}</span>
      <div className="flex justify-between text-xs text-slate-500">
        <span>נדרש</span><span className="font-semibold text-slate-700">{required}</span>
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>שובץ</span><span className="font-semibold text-slate-700">{allocated}</span>
      </div>
      <div className={`flex justify-between text-xs font-bold mt-0.5 ${mainColor}`}>
        {isComplete ? (
          <span className="w-full text-center">✓ הכל שובץ</span>
        ) : isOver ? (
          <>
            <span>חריגה</span>
            <span>+{Math.abs(remaining)}</span>
          </>
        ) : (
          <>
            <span>נותרו</span>
            <span>{remaining}</span>
          </>
        )}
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
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">דרישות לינה — סיכום שיבוץ</h3>

      {/* ── Overall status banner ─────────────────────────────────────────── */}
      {hasAny && (
        <div className={`rounded-xl border px-4 py-3 space-y-1 ${
          overAllocated
            ? "bg-amber-50 border-amber-300"
            : counts.isComplete
            ? "bg-emerald-50 border-emerald-300"
            : counts.totalAllocated > 0
            ? "bg-amber-50 border-amber-300"
            : "bg-slate-50 border-slate-200"
        }`}>
          <p className={`text-xs font-bold ${
            overAllocated ? "text-amber-800"
            : counts.isComplete ? "text-emerald-800"
            : counts.totalAllocated > 0 ? "text-amber-800"
            : "text-slate-600"
          }`}>
            {overAllocated
              ? `שובצו יותר מקומות לינה מהדרישה הנוכחית — נדרש: ${counts.totalRequired}, שובץ: ${counts.totalAllocated} (עודף ${overCount})`
              : counts.isComplete
              ? "✓ כל האנשים שובצו"
              : counts.totalAllocated > 0
              ? "שיבוץ חלקי"
              : "ממתין לשיבוץ"}
          </p>
          <div className="flex gap-4 text-[11px] text-slate-600">
            <span>סה״כ נדרש: <strong>{counts.totalRequired}</strong></span>
            <span>שובץ: <strong>{counts.totalAllocated}</strong></span>
            {counts.totalRemaining > 0 && (
              <span className="font-semibold text-amber-700">נותרו: {counts.totalRemaining}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Students block ───────────────────────────────────────────────── */}
      {hasStudents && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">תלמידים / חניכים</p>
          {hasBothGenders ? (
            <div className="grid grid-cols-3 gap-2">
              <Counter label="בנים"  required={boysRequired}  allocated={allocatedBoys}  />
              <Counter label="בנות"  required={girlsRequired} allocated={allocatedGirls} />
              <Counter label="סה״כ"  required={counts.studentRequired} allocated={counts.studentAllocated} />
            </div>
          ) : boysRequired > 0 ? (
            <Counter label="בנים" required={boysRequired} allocated={allocatedBoys} />
          ) : (
            <Counter label="בנות" required={girlsRequired} allocated={allocatedGirls} />
          )}
          {/* Mixed allocation note */}
          {hasBothGenders && allocatedMixed > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              ⚠️ {allocatedMixed} אנשים שובצו עם תגית "מעורב" — מומלץ לשבץ עם בנים/בנות לספירה מדויקת
            </div>
          )}
        </div>
      )}

      {/* ── Staff / VIP block ────────────────────────────────────────────── */}
      {hasStaff && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">צוות / מלווים / VIP</p>
          <Counter label="צוות" required={counts.staffRequired} allocated={counts.staffAllocated} />
          {/* Breakdown of WHERE staff sleep */}
          {(counts.vipAllocated > 0 || counts.altTentAllocated > 0 || counts.otherStaffAllocated > 0) && (
            <div className="text-[10px] text-slate-400 mt-1.5 px-1 space-y-0.5">
              {counts.vipAllocated > 0 && (
                <p>מתוכם VIP: {counts.vipPaxVariesByPeriod ? "כמות משתנה לפי תקופה" : counts.vipAllocated} ({counts.vipTentCount} אוהלים)</p>
              )}
              {counts.altTentAllocated > 0 && (
                <p>מתוכם אוהל חילופי: {counts.altTentAllocated} ({counts.altTentCount} אוהלים)</p>
              )}
              {counts.otherStaffAllocated > 0 && (
                <p>מתוכם צוות אחר: {counts.otherStaffAllocated}</p>
              )}
            </div>
          )}
        </div>
      )}

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