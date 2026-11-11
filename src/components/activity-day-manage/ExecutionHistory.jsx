import React from "react";
import { OP_LABELS } from "@/lib/activityDayManageApi";

export default function ExecutionHistory({ history, stations }) {
  if (!history?.length) return null;
  const title = (id) => stations.find(s => s.station_id === id)?.title || "";
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-sm font-semibold text-slate-800 mb-2">היסטוריית שינויים</div>
      <ul className="space-y-1 text-xs text-slate-600">
        {history.map(h => (
          <li key={h.op_id + h.type}>
            {new Date(h.at).toLocaleString("he-IL")} · {OP_LABELS[h.type] || h.type}{h.station_id ? ` "${title(h.station_id)}"` : ""} · {h.by}
            {h.post_conflict && <span className="text-yellow-700"> · התנגשות שזוהתה לאחר השמירה: {h.post_conflict}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}