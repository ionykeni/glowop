import { DAY_TONE } from "./AvailabilityDayCell";

const d = night => night.slice(5).split("-").reverse().join("/");

export default function AvailabilityDayDetail({ info }) {
  if (!info) return <p className="text-xs text-slate-400 text-center">בחרו תאריך לפרטים</p>;
  return (
    <div className="rounded-xl border bg-white px-4 py-3 space-y-2 text-sm">
      <div className="font-bold text-slate-700">{d(info.night)}</div>
      <div><div className="font-semibold text-slate-700">🛏️ לינה רגילה</div><div className="text-slate-600">{info.regular_places} מקומות זמינים · {info.regular_tents} אוהלים פנויים</div></div>
      <div><div className="font-semibold text-slate-700">⭐ VIP</div><div className="text-slate-600">{info.vip_places} מקומות זמינים</div></div>
      <div className="font-medium">{DAY_TONE[info.status]?.label}</div>
    </div>
  );
}