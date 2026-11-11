import React from "react";
import { Clock, MapPin, Pencil, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ManagedStationCard({ station, editable, onEdit, onCancel }) {
  const cancelled = station.status === "CANCELLED";
  const warn = station.out_of_sync || station.duplicates > 0 || station.detached > 0;
  return (
    <div className={`bg-white border rounded-lg p-4 space-y-2 ${cancelled ? "border-slate-200 opacity-60" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800">{station.title || "תחנה"}</span>
            {cancelled && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">בוטלה</span>}
            {station.edited && !cancelled && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">נערכה</span>}
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-600 mt-1 flex-wrap">
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {station.start_time}–{station.end_time}</span>
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {station.space_name || "—"}</span>
          </div>
        </div>
        {editable && !cancelled && (
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> עריכה</Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={onCancel}><XCircle /> ביטול</Button>
          </div>
        )}
      </div>
      {!cancelled && (
        <div className="flex flex-wrap gap-1">
          {station.groups.map(g => (
            <span key={g.group_id} className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700" title={g.synced ? "מסונכרן ליומן" : "טרם נצפה סנכרון ליומן"}>
              {g.group_name}{!g.synced && " ·"}
            </span>
          ))}
          {station.groups.length === 0 && <span className="text-xs text-slate-400">אין קבוצות פעילות</span>}
        </div>
      )}
      {cancelled && station.cancelled_at && <div className="text-xs text-slate-500">בוטלה {new Date(station.cancelled_at).toLocaleString("he-IL")} {station.cancelled_by ? `ע״י ${station.cancelled_by}` : ""}</div>}
      {warn && !cancelled && (
        <div className="text-xs text-yellow-800 bg-yellow-50 rounded p-2 flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>הרשומות של התחנה אינן אחידות{station.duplicates > 0 ? ` · ${station.duplicates} כפולות` : ""}{station.detached > 0 ? ` · ${station.detached} נותקו מהפעילות המשותפת` : ""}{station.detached > 0 ? ". לא ניתן לערוך את התחנה עד שהמצב יתוקן" : ". שמירת עריכה תאחד אותן"}</span>
        </div>
      )}
    </div>
  );
}