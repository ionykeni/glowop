import { fmtMinutes } from "@/lib/attendanceFormat";

// Verified hours and automatically-closed (unverified) hours are always shown separately.
export default function TotalsChips({ totals }) {
  const t = totals || { verified_minutes: 0, unverified_minutes: 0, active_minutes: 0, session_count: 0, corrected_count: 0, auto_closed_count: 0 };
  const items = [
    { label: "שעות עבודה", value: fmtMinutes(t.verified_minutes), cls: "text-foreground" },
    { label: "רשומות", value: t.session_count, cls: "text-foreground" },
    t.active_minutes > 0 && { label: "בעבודה כעת", value: fmtMinutes(t.active_minutes), cls: "text-sage-foreground" },
    t.unverified_minutes > 0 && { label: `נסגר אוטומטית (${t.auto_closed_count}), לא מאושר`, value: fmtMinutes(t.unverified_minutes), cls: "text-red-600" },
    t.corrected_count > 0 && { label: "תוקנו ידנית", value: t.corrected_count, cls: "text-amber-700" },
  ].filter(Boolean);
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-3xl bg-sage/50 p-1.5 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-2xl bg-card/85 px-4 py-3">
          <p className={`text-lg font-semibold tabular-nums ${i.cls}`}>{i.value}</p>
          <p className="text-[11px] leading-tight text-muted-foreground">{i.label}</p>
        </div>
      ))}
    </div>
  );
}