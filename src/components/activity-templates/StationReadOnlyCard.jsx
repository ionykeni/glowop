import { Clock, MapPin } from "lucide-react";
import { LogisticsBadges } from "@/components/schedule/LogisticsFields";

export default function StationReadOnlyCard({ station, index, spaceName }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center shrink-0">{index + 1}</span>
        <p className="font-semibold text-slate-800">{station.title || "—"}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{station.start_time || "--:--"}–{station.end_time || "--:--"}</span>
        {station.suggested_space_id && (
          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{spaceName || "מרחב לא זמין"} (מוצע)</span>
        )}
      </div>
      {station.description && <p className="text-sm text-slate-600 whitespace-pre-line">{station.description}</p>}
      <LogisticsBadges item={station} />
      {station.preparation_notes && <p className="text-xs text-slate-500 whitespace-pre-line">הכנה: {station.preparation_notes}</p>}
    </div>
  );
}