import StaffGenderCounter from "./StaffGenderCounter";

function StatRow({ label, value, sub }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-xs ${sub ? "text-slate-400 pr-3" : "text-slate-600 font-medium"}`}>{label}</span>
      <span className={`text-sm font-semibold ${sub ? "text-slate-500" : "text-slate-800"}`}>
        {value != null ? value : <span className="text-slate-300 font-normal text-xs">—</span>}
      </span>
    </div>
  );
}

function CountdownBadge({ total, assigned, color }) {
  if (total == null) return null;
  const remaining = total - assigned;
  const done = remaining === 0;
  return (
    <div className={`mt-2 rounded-lg px-3 py-1.5 text-xs flex items-center justify-between border ${
      done
        ? "bg-emerald-50 border-emerald-300 text-emerald-700"
        : remaining < 0
          ? "bg-red-50 border-red-300 text-red-700"
          : `${color}`
    }`}>
      <span>שובצו: <strong>{assigned}</strong> / {total}</span>
      <span className="font-bold">
        {done ? "✓ הכל שובץ" : remaining < 0 ? `${Math.abs(remaining)} עודף!` : `נותרו: ${remaining}`}
      </span>
    </div>
  );
}

function SummaryGroup({ color, borderColor, title, children }) {
  return (
    <div className={`rounded-xl border p-3 space-y-1 ${color} ${borderColor}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{title}</p>
      {children}
    </div>
  );
}

/**
 * PeopleSummaryCard
 *
 * Staff/VIP counting rule (E, F, G):
 * All person type labels (צוות, מדריך, נהג, מורה, VIP, אבטחה, DRIVER, GUIDE, OTHER…)
 * count toward the SINGLE staff_count total.
 * person_type is an operational label only — it does NOT create a separate required bucket.
 * אוהל חילופי pax also counts toward the same staff total.
 */
export default function PeopleSummaryCard({ profile, vipRows = [], boysDist = [], girlsDist = [], staffAltTentPax, staffAltTentNotes, staffMenCount, staffWomenCount, onStaffMaleChange, onStaffFemaleChange }) {
  const staffTotal = profile.staff_count ?? null;

  // ALL vip rows count toward staff total — no distinction by person type
  const vipPeopleAssigned = vipRows.reduce((s, r) => s + (Number(r.people_count) || 0), 0);

  // Alt tent also counts toward staff total
  const altTentAssigned = Number(staffAltTentPax) || 0;

  // Total staff assigned = VIP rows + alt tent
  const totalStaffAssigned = vipPeopleAssigned + altTentAssigned;

  // Student countdown
  const boysAssigned  = boysDist.reduce((s, r) => s + (r.tent_count || 0) * (r.people_per_tent || 0), 0);
  const girlsAssigned = girlsDist.reduce((s, r) => s + (r.tent_count || 0) * (r.people_per_tent || 0), 0);

  // Gender split mismatch detection
  const participantCount = Number(profile.participant_count) || 0;
  const boysCount        = Number(profile.boys_count)  || 0;
  const girlsCount       = Number(profile.girls_count) || 0;
  const genderSum        = boysCount + girlsCount;
  const hasGenderData    = genderSum > 0;
  const genderSplitMismatch = profile.is_sleeping_group && participantCount > 0 && hasGenderData && genderSum !== participantCount;
  const genderSplitMissing  = profile.is_sleeping_group && participantCount > 0 && !hasGenderData;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-bold text-slate-700">סיכום לינה לקבוצה</p>
        {profile.total_pax != null && (
          <span className="text-xs bg-slate-100 border border-slate-200 rounded-full px-3 py-1 font-semibold text-slate-600">
            סה״כ: {profile.total_pax} אנשים
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Students */}
        <SummaryGroup color="bg-emerald-50" borderColor="border-emerald-200" title="חניכים / תלמידים">
          <StatRow label='סה״כ חניכים' value={profile.participant_count} />
          {hasGenderData ? (
            <div className="flex gap-2 mt-1">
              <div className="flex-1 bg-emerald-100 border border-emerald-300 rounded-lg px-2 py-1.5 text-center">
                <p className="text-[10px] text-emerald-700 font-semibold">בנים</p>
                <p className="text-base font-bold text-emerald-800">{profile.boys_count ?? "—"}</p>
              </div>
              <div className="flex-1 bg-orange-100 border border-orange-300 rounded-lg px-2 py-1.5 text-center">
                <p className="text-[10px] text-orange-700 font-semibold">בנות</p>
                <p className="text-base font-bold text-orange-800">{profile.girls_count ?? "—"}</p>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">חלוקת בנים/בנות לא הוגדרה עדיין</p>
          )}

          {/* Gender split mismatch warning — shown instead of completion badge */}
          {genderSplitMismatch && (() => {
            const missing = participantCount - genderSum;
            return (
              <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 space-y-0.5">
                <p className="font-semibold">⚠️ חלוקת בנים/בנות לא תואמת למספר החניכים</p>
                <p>סה״כ חניכים: <strong>{participantCount}</strong></p>
                <p>בנים + בנות: <strong>{genderSum}</strong></p>
                <p className="font-bold">{missing > 0 ? `חסרים ${missing} חניכים בחלוקה.` : `יש ${Math.abs(missing)} חניכים יותר מדי בחלוקה.`}</p>
              </div>
            );
          })()}

          {genderSplitMissing && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              ⚠️ יש להזין חלוקת בנים / בנות כדי להשלים את דרישות הלינה
            </div>
          )}

          {/* Per-gender countdowns — only shown when no mismatch */}
          {!genderSplitMismatch && profile.boys_count != null && (
            <CountdownBadge total={profile.boys_count} assigned={boysAssigned} color="bg-emerald-50 border-emerald-200 text-emerald-700" />
          )}
          {!genderSplitMismatch && profile.girls_count != null && (
            <CountdownBadge total={profile.girls_count} assigned={girlsAssigned} color="bg-orange-50 border-orange-200 text-orange-700" />
          )}
        </SummaryGroup>

        {/* Staff / VIP — ALL person types count together toward staff_count */}
        <SummaryGroup color="bg-violet-50" borderColor="border-violet-200" title="צוות / מורים / VIP">
          <StatRow label='סה״כ צוות / מלווים' value={staffTotal} />
          <StaffGenderCounter
            staffTotal={staffTotal}
            maleStaff={staffMenCount}
            femaleStaff={staffWomenCount}
            onMaleChange={onStaffMaleChange}
            onFemaleChange={onStaffFemaleChange}
          />

          {/* Single countdown: only VIP rows count as "real" allocation */}
          {vipPeopleAssigned > 0 ? (
            <CountdownBadge
              total={staffTotal}
              assigned={totalStaffAssigned}
              color="bg-violet-50 border-violet-200 text-violet-700"
            />
          ) : staffTotal != null ? (
            <div className="mt-2 rounded-lg px-3 py-1.5 text-xs flex items-center justify-between border bg-amber-50 border-amber-300 text-amber-700">
              <span>שובצו: <strong>0</strong> / {staffTotal}</span>
              <span className="font-medium">* כולם באוהל חילופי</span>
            </div>
          ) : null}

          <div className="text-[10px] text-violet-500 pt-0.5 space-y-0.5">
            <p>→ אוהלי VIP (80–89): {vipPeopleAssigned} אנשים</p>
            {altTentAssigned > 0 && <p>→ אוהל חילופי: {altTentAssigned} אנשים</p>}
          </div>

          {altTentAssigned > 0 && staffAltTentNotes && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">הערות חילופי: {staffAltTentNotes}</p>
          )}
        </SummaryGroup>

      </div>
    </div>
  );
}