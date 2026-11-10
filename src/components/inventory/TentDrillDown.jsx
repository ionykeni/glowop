import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { WorkingStatusBadge, BedStatusBadge } from "./StatusBadge";
import EditStatusModal from "./EditStatusModal";
import { Pencil, ChevronDown, ChevronUp, Home, Shield } from "lucide-react";

export default function TentDrillDown({ tent, beds, isAdmin, onDataChange }) {
  const [expanded, setExpanded] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editType, setEditType] = useState(null);

  const handleEditTent = (e) => {
    e.stopPropagation();
    setEditTarget(tent);
    setEditType("tent");
  };

  const handleEditBed = (bed) => {
    setEditTarget(bed);
    setEditType("bed");
  };

  const handleSave = async (id, updates) => {
    if (editType === "tent") {
      await base44.entities.Tent.update(id, updates);
    } else {
      await base44.entities.Bed.update(id, updates);
    }
    onDataChange?.();
  };

  const bedTypeLabel = (type) => {
    if (type === "BUNK_TOP") return "עליונה";
    if (type === "BUNK_BOTTOM") return "תחתונה";
    return "";
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/50 transition-colors text-right cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setExpanded(!expanded); } }}
      >
        <div className="flex items-center gap-3">
          {tent.tent_type === "VIP" ? (
            <Shield className="w-4 h-4 text-amber-500" />
          ) : (
            <Home className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="font-semibold text-sm">{tent.code}</span>
          {tent.is_accessible && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">♿</span>
          )}
          <WorkingStatusBadge status={tent.working_status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{beds.length} מיטות</span>
          {isAdmin && (
            <button
              onClick={handleEditTent}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="bg-muted/20 px-4 py-3 border-t border-border">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {beds.map((bed) => (
              <div
                key={bed.id}
                className="bg-card border border-border rounded-md px-3 py-2 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate">{bed.label}</span>
                  {isAdmin && (
                    <button
                      onClick={() => handleEditBed(bed)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <BedStatusBadge status={bed.bed_status} />
                  <WorkingStatusBadge status={bed.working_status} />
                </div>
                {bed.bed_type !== "SINGLE" && (
                  <span className="text-xs text-muted-foreground">{bedTypeLabel(bed.bed_type)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editTarget && (
        <EditStatusModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          entity={editTarget}
          entityType={editType}
          onSave={handleSave}
        />
      )}
    </div>
  );
}