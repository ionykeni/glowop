import { useState } from "react";
import MaintenanceHistory from "./MaintenanceHistory";
import WeeklyHistory from "./WeeklyHistory";

const VIEWS = [
  { id: "events", label: "יומן ביצועים" },
  { id: "weeks", label: "שבועות קודמים" },
];

export default function HistoryTab({ isManager, onVoid }) {
  const [view, setView] = useState("events");
  if (!isManager) return <MaintenanceHistory onVoid={onVoid} />;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              view === v.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "events" ? <MaintenanceHistory onVoid={onVoid} /> : <WeeklyHistory />}
    </div>
  );
}