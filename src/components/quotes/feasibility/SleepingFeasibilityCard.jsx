import FeasibilitySection from "./FeasibilitySection";

const d = night => night ? night.slice(5).split("-").reverse().join("/") : "";
const addDay = night => { const x = new Date(`${night}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const STATUS = {
  OK: { box: "border-green-200 bg-green-50", text: "text-green-800", label: "🟢 נראה אפשרי בתרחיש שמרני" },
  NEEDS_REVIEW: { box: "border-amber-300 bg-amber-50", text: "text-amber-800", label: "🟡 נדרש בירור" },
  NOT_FEASIBLE: { box: "border-red-300 bg-red-50", text: "text-red-800", label: "🔴 לא נראה אפשרי" },
};
const fitLine = result => result === "ALL"
  ? { status: "✓ מתאים גם ללא חלוקת בנים/בנות", tone: "ok" }
  : result === "SOME"
    ? { status: "⚠️ הזמינות תלויה בחלוקת בנים/בנות", tone: "warn" }
    : { status: "✕ אין מספיק אוהלים פנויים", tone: "bad" };

export default function SleepingFeasibilityCard({ f }) {
  const s = STATUS[f.status] || STATUS.NEEDS_REVIEW;
  const { people, standard, vip, breakdown } = f;
  const std = fitLine(standard.result);
  const vipShort = vip.status === "VIP_OVERFLOW_TO_ALT" || vip.status === "NOT_FEASIBLE";
  const altFromVip = vipShort ? vip.overflow : 0;
  const vipPlaced = vip.people - altFromVip;
  return (
    <div className={`rounded-xl border px-4 py-3 space-y-2 ${s.box}`} dir="rtl">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-700">זמינות לינה</span>
        <span className="text-[11px] text-slate-500">{d(f.first_night)}–{d(addDay(f.last_night))}</span>
      </div>
      <div className={`text-sm font-bold ${s.text}`}>{s.label}</div>
      {f.reasons.includes("GENDER_SPLIT_DEPENDENT") && (
        <div className="text-xs text-amber-700">חלוקת בנים/בנות עשויה להשפיע על הזמינות — יש לקבל חלוקה לפני התחייבות.</div>
      )}
      {f.physical_capacity_has_unmodeled_holds && <div className="text-xs text-amber-700">קיימות שריונות ללא פירוט לינה מלא.</div>}
      {f.reasons.includes("EXISTING_DATA_INCOMPLETE") && <div className="text-xs text-amber-700">חסרים נתוני לינה לחלק מהקבוצות הקיימות.</div>}

      <FeasibilitySection icon="👥" title="סה״כ לינה"
        lines={people.capacity > 0
          ? [`${people.peak_projected} / ${people.capacity} בלילה העמוס ביותר`, `${d(people.peak_date)} · ${people.remaining >= 0 ? `נותרו ${people.remaining} מקומות` : `חריגה של ${-people.remaining}`}`]
          : ["קיבולת לינה לא הוגדרה"]}
        status={people.exceeded ? "✕ חריגה מהתפוסה המקסימלית" : people.near_full ? "⚠️ האתר קרוב לתפוסה מלאה" : null}
        tone={people.exceeded ? "bad" : "warn"} />

      {breakdown.students > 0 && (
        <FeasibilitySection icon="🏕️" title="תלמידים"
          lines={[`${breakdown.students} איש`, `דרישה שמרנית: ${standard.students_estimate.conservative ?? "—"} אוהלים`, `זמינים בלילה המגביל (${d(standard.limiting_date)}): ${standard.available_tents}`]}
          {...std} />
      )}

      {standard.alt_people > 0 && (
        <FeasibilitySection icon="⛺" title={altFromVip > 0 ? "אוהל חילופי" : "צוות בלינה רגילה"}
          lines={[
            altFromVip > 0 ? `${standard.alt_people} אנשי צוות (${altFromVip} מתוכם עקב חוסר מקום ב־VIP)` : `${standard.alt_people} אנשי צוות`,
            `דרישה שמרנית: ${standard.alt_estimate.conservative ?? "—"} אוהלים`,
            `זמינים: ${standard.available_tents}`,
          ]}
          status={standard.result === "NO" ? std.status : standard.result === "SOME" ? std.status : "✓ אפשרי"} tone={std.tone} />
      )}

      {vip.people > 0 && (
        <FeasibilitySection icon="🏠" title="VIP"
          lines={[
            vipShort ? `${vipPlaced} אנשי צוות (מתוך ${vip.people}) · זמינים ${vip.available_capacity} מקומות` : `${vip.people} אנשי צוות`,
            vip.estimate.minimum !== null && `מינימום: ${vip.estimate.minimum} · לחישוב בטוח: ${vip.estimate.conservative ?? "—"}`,
            `זמינים: ${vip.available_tents} אוהלים (${d(vip.limiting_date)})`,
          ]}
          status={vip.status === "OK" ? "✓ מספיק" : vip.status === "VIP_OVERFLOW_TO_ALT" ? `✓ ${altFromVip} עוברים לאוהל חילופי` : "✕ אין מספיק מקום ב־VIP וגם לא באוהל חילופי"}
          tone={vip.status === "NOT_FEASIBLE" ? "bad" : "ok"} />
      )}

      <p className="text-[10px] text-slate-400 pt-1">מבוסס על קבוצות תפעוליות, תקופות שהייה, שיבוצי לינה ומלאי אוהלים פעיל · אזהרה בלבד</p>
    </div>
  );
}