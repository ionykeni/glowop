import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import HousekeepingStatusBadge from "./HousekeepingStatusBadge";
import RoleGate from "@/components/RoleGate";
import { useRoleContext } from "@/lib/RoleContext";
import { hasPermission } from "@/lib/roles";

const GENDER_LABEL = { BOYS: "בנים", GIRLS: "בנות", MEN: "גברים", WOMEN: "נשים" };

const HK_STATUSES = [
  { value: "PENDING",     label: "ממתין" },
  { value: "IN_PROGRESS", label: "בניקיון" },
  { value: "READY",       label: "מוכן" },
  { value: "ISSUE",       label: "בעיה" },
];

export default function TentAllocationRow({ allocation, tent, neighborhood, hideNeighborhood = false }) {
  const queryClient = useQueryClient();
  const { role } = useRoleContext();
  const canMark = hasPermission(role, "MARK_TENT_READY");

  const handleStatusChange = async (newStatus) => {
    await opWrite.SleepingAllocation.update(allocation.id, {
      housekeeping_status: newStatus,
    });
    queryClient.invalidateQueries({ queryKey: ["sleepingAllocations"] });
  };

  if (!tent) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        שיבוץ לא תקין — אוהל לא נמצא (ID: {allocation.tent_id?.slice(-6)})
      </div>
    );
  }

  const isVip = allocation.allocation_type === "STAFF" || tent.tent_type === "VIP";

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        {/* Tent code */}
        <span className="font-bold text-sm text-slate-800 shrink-0">{tent.code}</span>

        {/* VIP badge */}
        {isVip && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 shrink-0">
            VIP / צוות
          </span>
        )}

        {/* Neighborhood — hidden when rendered inside a neighborhood card */}
        {neighborhood && !hideNeighborhood && (
          <span className="text-xs text-slate-500 shrink-0">
            {neighborhood.name}
          </span>
        )}

        {/* Pax — cleaner-friendly label */}
        <span className="text-xs font-semibold text-slate-700 shrink-0 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
          להכין {allocation.allocated_pax} מיטות
        </span>

        {/* Gender */}
        {allocation.gender_group && (
          <span className="text-xs text-slate-500 shrink-0">
            {GENDER_LABEL[allocation.gender_group] || allocation.gender_group}
          </span>
        )}

        {/* Notes */}
        {allocation.notes && (
          <span className="text-xs text-slate-400 truncate max-w-[160px]" title={allocation.notes}>
            📝 {allocation.notes}
          </span>
        )}
      </div>

      {/* Status selector */}
      <div className="shrink-0 flex items-center gap-2">
        <HousekeepingStatusBadge status={allocation.housekeeping_status || "PENDING"} />
        {canMark ? (
          <select
            value={allocation.housekeeping_status || "PENDING"}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {HK_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}