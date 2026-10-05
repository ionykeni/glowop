import FeasibilitySection from "./FeasibilitySection";

const d = night => night ? night.slice(5).split("-").reverse().join("/") : "";
const STATUS = {
  OK: { box: "border-green-200 bg-green-50", text: "text-green-800", label: "🟢 נראה אפשרי" },
  NEEDS_REVIEW: { box: "border-amber-300 bg-amber-50", text: "text-amber-800", label: "🟡 נראה אפשרי, נדרש לשים לב" },
  NOT_FEASIBLE: { box: "border-red-300 bg-red-50", text: "text-red-800", label: "🔴 לא נראה אפשרי" },
};
const FIT = {
  ALL: { status: "✓ נראה אפשרי", tone: "ok" },
  SOME: { status: "⚠️ חלוקת בנים/בנות עשויה להשפיע", tone: "warn" },
  NO: { status: "✕ אין מספיק אוהלים", tone: "bad" },
};

function topReason(f, altFromVip) {
  if (f.people.exceeded || f.people.near_full) return "האתר קרוב לתפוסה מלאה";
  if (f.standard.result === "NO" || f.vip.status === "NOT_FEASIBLE") return "אין מספיק אוהלים";
  if (f.standard.result === "SOME") return "חלוקת בנים/בנות עשויה להשפיע";
  if (altFromVip > 0) return "נדרש אוהל חילופי לצוות";
  return null;
}

export default function SleepingFeasibilityCard({ f }) {
  const s = STATUS[f.status] || STATUS.NEEDS_REVIEW;
  const { people, standard, vip, breakdown } = f;
  const fit = FIT[standard.result] || FIT.NO;
  const altFromVip = vip.status === "VIP_OVERFLOW_TO_ALT" || vip.status === "NOT_FEASIBLE" ? vip.overflow : 0;
  const staffTotal = breakdown.regular_staff + breakdown.vip_people;
  const reason = topReason(f, altFromVip);
  return (
    <div className={`rounded-xl border px-4 py-3 space-y-2 ${s.box}`} dir="rtl">
      <div className="text-xs font-semibold text-slate-600">זמינות לינה</div>
      <div className={`text-sm font-bold ${s.text}`}>{s.label}</div>
      {reason && <div className="text-xs text-slate-600">{reason}</div>}

      <FeasibilitySection icon="👥" title="סה״כ לינה"
        lines={people.capacity > 0
          ? [`${people.peak_projected} / ${people.capacity} בלילה העמוס ביותר`, `${d(people.peak_date)} · ${people.remaining >= 0 ? `נותרו ${people.remaining} מקומות` : `חריגה של ${-people.remaining}`}`]
          : ["קיבולת לינה לא הוגדרה"]} />

      {breakdown.students > 0 && (
        <FeasibilitySection icon="🏕️" title="תלמידים"
          lines={[`${breakdown.students} איש`, `דרישה שמרנית: ${standard.students_estimate.conservative ?? "—"} אוהלים`, `זמינים: ${standard.available_tents}`]}
          {...fit} />
      )}

      {staffTotal > 0 && vip.people > 0 && (
        <FeasibilitySection icon="🏠" title="צוות / VIP"
          lines={altFromVip > 0
            ? [`${vip.people} איש`, `${vip.people - altFromVip} ב־VIP`]
            : [`${vip.people} איש`, `נדרשים בבטחה: ${vip.estimate.conservative ?? "—"} אוהלי VIP`, `זמינים: ${vip.available_tents}`]}
          status={altFromVip > 0 ? null : "✓ מספיק"} />
      )}

      {staffTotal > 0 && standard.alt_people > 0 && (
        <FeasibilitySection icon="⛺" title="אוהל חילופי"
          lines={[`${standard.alt_people} אנשי צוות`, `נדרשים: ${standard.alt_estimate.conservative ?? "—"} אוהלים`]}
          status={standard.result === "NO" ? "✕ אין מספיק אוהלים" : "✓ אפשרי"}
          tone={standard.result === "NO" ? "bad" : "ok"} />
      )}
    </div>
  );
}