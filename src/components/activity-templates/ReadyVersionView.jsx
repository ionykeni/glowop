import { Link } from "react-router-dom";
import { Lock, ClipboardList } from "lucide-react";
import StationReadOnlyCard from "./StationReadOnlyCard";
import TemplateMessages from "./TemplateMessages";

export default function ReadyVersionView({ template, spacesById, warnings }) {
  const stations = template.stations || [];
  return (
    <div className="space-y-3">
      <div className="activity-day-section space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-slate-800 flex-1">{template.name}</h2>
          <span className="flex items-center gap-1 text-[11px] text-slate-500"><Lock className="w-3.5 h-3.5" /> גרסה {template.version} נעולה</span>
        </div>
        {template.description && <p className="text-sm text-slate-600 whitespace-pre-line">{template.description}</p>}
        <Link to={`/activity-day-templates/plan?template=${template.id}`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90">
          <ClipboardList className="w-4 h-4" /> תכנון יום מהתבנית
        </Link>
        {template.ready_at && (
          <p className="text-[11px] text-slate-400">סומנה כמוכנה {new Date(template.ready_at).toLocaleString("he-IL")}{template.ready_by_email ? ` · ${template.ready_by_email}` : ""}</p>
        )}
      </div>
      <h3 className="font-semibold text-slate-700">תחנות ({stations.length})</h3>
      {stations.map((s, i) => (
        <StationReadOnlyCard key={s.station_id} station={s} index={i} spaceName={spacesById[s.suggested_space_id]?.name} />
      ))}
      <TemplateMessages warnings={warnings} />
    </div>
  );
}