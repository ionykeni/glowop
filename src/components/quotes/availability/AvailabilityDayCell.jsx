export const DAY_TONE = {
  GREEN: { cell: "bg-green-50 border-green-200", label: "🟢 זמינות טובה" },
  YELLOW: { cell: "bg-amber-50 border-amber-200", label: "🟡 זמינות מוגבלת" },
  RED: { cell: "bg-red-50 border-red-200", label: "🔴 זמינות נמוכה מאוד" },
};

export default function AvailabilityDayCell({ dayNum, info, selected, onClick }) {
  if (!dayNum) return <div />;
  const tone = info ? DAY_TONE[info.status] : null;
  return (
    <button type="button" onClick={onClick} disabled={!info}
      className={`h-16 rounded-lg border p-1 text-right text-[11px] leading-tight transition ${tone ? tone.cell : "bg-slate-50 border-slate-100"} ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="font-semibold text-slate-700">{dayNum}</div>
      {info && <>
        <div className="text-slate-600">🛏️ {info.regular_places}</div>
        <div className="text-slate-600">⭐ {info.vip_places}</div>
      </>}
    </button>
  );
}