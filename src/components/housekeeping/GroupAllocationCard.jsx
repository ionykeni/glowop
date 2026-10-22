import { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, MapPin, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { Button } from "@/components/ui/button";
import RoleGate from "@/components/RoleGate";
import { toast } from "sonner";
import NeighborhoodMapCard from "./NeighborhoodMapCard";
import NeighborhoodOnlyCard from "./NeighborhoodOnlyCard";
import { computeAllocationCounts } from "@/lib/allocationCounts";

const GENDER_LABEL = { BOYS: "בנים", GIRLS: "בנות", MEN: "גברים", WOMEN: "נשים", MIXED: "מעורב" };

// ── Status helpers ─────────────────────────────────────────────────────────────

function getStatus(allocations, draftAllocations, nhoodReservations, profile) {
  const confirmedCount = allocations.filter(a => a.status === "CONFIRMED").length;
  const draftCount     = draftAllocations.length;
  const nhoodCount     = nhoodReservations.length;

  if (confirmedCount > 0 && draftCount === 0) {
    // Check if this is a partial allocation using unified counts
    const allAllocs = [...allocations, ...draftAllocations];
    const counts = computeAllocationCounts(allAllocs, profile);
    if (counts.totalRemaining > 0) return "partial_confirmed";
    return "confirmed";
  }
  if (draftCount > 0)                          return "draft";
  if (nhoodCount > 0)                          return "neighborhood_only";
  return "none";
}

const STATUS_CONFIG = {
  confirmed:         { label: "שיבוץ לפי אוהלים מאושר",   badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: CheckCircle2, iconClass: "text-emerald-600" },
  partial_confirmed: { label: "שיבוץ חלקי",              badgeClass: "bg-amber-100 text-amber-700 border-amber-300",     icon: AlertTriangle, iconClass: "text-amber-500"   },
  draft:             { label: "שיבוץ לפי אוהלים טרם אושר", badgeClass: "bg-amber-100 text-amber-700 border-amber-300",     icon: AlertTriangle, iconClass: "text-amber-500"   },
  neighborhood_only: { label: "שיבוץ אזורי בלבד",          badgeClass: "bg-blue-100 text-blue-700 border-blue-300",        icon: MapPin,        iconClass: "text-blue-500"    },
  none:              { label: "קבוצה ללא שיבוץ לינה",       badgeClass: "bg-red-100 text-red-700 border-red-300",          icon: AlertTriangle, iconClass: "text-red-500"      },
};

const TYPE_BADGE = {
  checkin:  "bg-blue-100 text-blue-700 border-blue-300",
  checkout: "bg-orange-100 text-orange-700 border-orange-300",
  occupied: "bg-slate-100 text-slate-600 border-slate-300",
};
const TYPE_LABEL = { checkin: "CHECK IN", checkout: "CHECK OUT", occupied: "תפוס" };

// ── Card border color by status ────────────────────────────────────────────────
const BORDER_BY_STATUS = {
  confirmed:         "border-emerald-200",
  partial_confirmed: "border-amber-200",
  draft:             "border-amber-200",
  neighborhood_only: "border-blue-200",
  none:              "border-red-200",
};

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Props:
 *   group              - Group record
 *   allocations        - CONFIRMED SleepingAllocation[] (for this group on this date)
 *   draftAllocations   - DRAFT SleepingAllocation[] (for this group)
 *   nhoodReservations  - NeighborhoodReservation[] (ACTIVE, for this group)
 *   profiles           - OperationalGroupProfile[] (for this group — for dist JSON)
 *   tentsMap           - { [id]: Tent }
 *   neighborhoodsMap   - { [id]: Neighborhood }
 *   type               - "checkin" | "checkout" | "occupied"
 */
export default function GroupAllocationCard({
  group,
  allocations = [],
  draftAllocations = [],
  nhoodReservations = [],
  profiles = [],
  tentsMap,
  neighborhoodsMap,
  type,
  onRefresh,
}) {
  const [expanded, setExpanded] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);

  if (!group) return null;

  const profile    = profiles[0] || null;
  const status     = getStatus(allocations, draftAllocations, nhoodReservations, profile);
  const statusConf = STATUS_CONFIG[status];
  const StatusIcon = statusConf.icon;

  const totalPax = allocations.reduce((s, a) => s + (a.allocated_pax || 0), 0);
  const groupPax = group.total_pax || group.participant_count || 0;

  const handleMarkAllReady = async () => {
    const pendingIds = allocations
      .filter(a => a.status === "CONFIRMED" && a.housekeeping_status !== "READY")
      .map(a => a.id);
    if (!pendingIds.length) { toast.info("כל האוהלים כבר מסומנים כמוכנים"); return; }
    setMarkingReady(true);
    try {
      await Promise.all(pendingIds.map(id =>
        opWrite.SleepingAllocation.update(id, { housekeeping_status: "READY" })
      ));
      toast.success(`כל האוהלים סומנו כמוכנים (${pendingIds.length})`);
      onRefresh?.();
    } catch (err) {
      toast.error(err?.message || "שגיאה בסימון האוהלים");
    } finally {
      setMarkingReady(false);
    }
  };

  const typeBadgeClass = TYPE_BADGE[type] || TYPE_BADGE.checkin;
  const typeLabel      = TYPE_LABEL[type] || "CHECK IN";

  // ── Collapsed header ─────────────────────────────────────────────────────────
  return (
    <div className={`border rounded-xl overflow-hidden bg-white ${BORDER_BY_STATUS[status]}`}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full text-right px-4 py-3 flex items-center gap-3 hover:bg-slate-50/60 transition-colors"
      >
        {/* Status icon */}
        <StatusIcon className={`w-4 h-4 shrink-0 ${statusConf.iconClass}`} />

        {/* Group name */}
        <span className="font-bold text-sm text-slate-800 flex-1 text-right truncate">
          {group.group_name}
        </span>

        {/* Pax summary */}
        <span className="text-xs text-slate-500 shrink-0 flex items-center gap-1">
          <Users className="w-3 h-3" />
          {totalPax > 0 ? totalPax : groupPax}
        </span>

        {/* Status badge */}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${statusConf.badgeClass}`}>
          {statusConf.label}
        </span>

        {/* Type badge */}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${typeBadgeClass}`}>
          {typeLabel}
        </span>

        {/* Expand toggle */}
        {expanded
          ? <ChevronUp   className="w-4 h-4 text-slate-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        }
      </button>

      {/* ── Expanded content ──────────────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/30 p-3 space-y-3">

          {/* A: CONFIRMED specific tents */}
          {(status === "confirmed" || status === "partial_confirmed") && (
            <>
              {/* Partial allocation warning */}
              {status === "partial_confirmed" && (() => {
                const allAllocs = [...allocations, ...draftAllocations];
                const counts = computeAllocationCounts(allAllocs, profile);
                return (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">שיבוץ חלקי — חסרים {counts.totalRemaining} אנשים</p>
                      <p className="text-[11px] mt-0.5">סה״כ שובץ: {counts.totalAllocated} / {counts.totalRequired}</p>
                    </div>
                  </div>
                );
              })()}
              {type === "checkin" && (
                <RoleGate permission="MARK_TENT_READY">
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      onClick={handleMarkAllReady}
                      disabled={markingReady}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {markingReady ? "מסמן..." : "סמן הכל כמוכן"}
                    </Button>
                  </div>
                </RoleGate>
              )}
              <ConfirmedTenatils
                allocations={allocations}
                tentsMap={tentsMap}
                neighborhoodsMap={neighborhoodsMap}
                type={type}
              />
            </>
          )}

          {/* B: DRAFT specific tents — show tent list but warn */}
          {status === "draft" && (
            <DraftTentDetails
              draftAllocations={draftAllocations}
              tentsMap={tentsMap}
              neighborhoodsMap={neighborhoodsMap}
            />
          )}

          {/* C: Neighborhood-only */}
          {status === "neighborhood_only" && (
            <NeighborhoodOnlyDetails
              nhoodReservations={nhoodReservations}
              neighborhoodsMap={neighborhoodsMap}
              profile={profile}
              type={type}
            />
          )}

          {/* D: No allocation */}
          {status === "none" && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              קבוצה ללא שיבוץ לינה — יש לבצע שיבוץ בטאב לינה
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────────────────

function ConfirmedTenatils({ allocations, tentsMap, neighborhoodsMap, type }) {
  // Group by neighborhood
  const byNeighborhood = {};
  allocations.forEach(a => {
    const nid = a.neighborhood_id || "__none__";
    if (!byNeighborhood[nid]) byNeighborhood[nid] = [];
    byNeighborhood[nid].push(a);
  });

  const tentsByNeighborhood = {};
  Object.values(tentsMap).forEach(t => {
    if (!t?.neighborhood_id) return;
    if (!tentsByNeighborhood[t.neighborhood_id]) tentsByNeighborhood[t.neighborhood_id] = [];
    tentsByNeighborhood[t.neighborhood_id].push(t);
  });

  const neighborhoodEntries = Object.entries(byNeighborhood).sort(([aId], [bId]) => {
    const a = neighborhoodsMap[aId];
    const b = neighborhoodsMap[bId];
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.is_vip && !b.is_vip) return 1;
    if (!a.is_vip && b.is_vip) return -1;
    return (a.sort_order ?? 999) - (b.sort_order ?? 999);
  });

  const isCheckout = type === "checkout";

  return (
    <div className="space-y-3">
      {isCheckout && (
        <p className="text-xs font-semibold text-orange-700">
          האוהלים הבאים לניקוי / שחרור:
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {neighborhoodEntries.map(([nid, allocs]) => (
          isCheckout
            ? <CheckoutTentList
                key={nid}
                neighborhood={neighborhoodsMap[nid]}
                allocations={allocs}
                tentsMap={tentsMap}
              />
            : <NeighborhoodMapCard
                key={nid}
                neighborhood={neighborhoodsMap[nid]}
                allocations={allocs}
                tentsMap={tentsMap}
                allNeighborhoodTents={tentsByNeighborhood[nid] || []}
              />
        ))}
      </div>
    </div>
  );
}

function CheckoutTentList({ neighborhood, allocations, tentsMap }) {
  const nhoodName = neighborhood?.name || "שכונה לא ידועה";
  const sortedAllocs = [...allocations].sort((a, b) => {
    const ta = tentsMap[a.tent_id];
    const tb = tentsMap[b.tent_id];
    return (Number(String(ta?.code || "").match(/\d+/)?.[0] || 9999))
         - (Number(String(tb?.code || "").match(/\d+/)?.[0] || 9999));
  });

  return (
    <div className="border border-orange-200 bg-orange-50/40 rounded-xl p-3 space-y-2">
      <p className="font-bold text-sm text-slate-800">{nhoodName}</p>
      <div className="space-y-1">
        {sortedAllocs.map(a => {
          const tent = tentsMap[a.tent_id];
          return (
            <div key={a.id} className="flex items-center justify-between text-xs px-2 py-1.5 bg-white border border-orange-200 rounded-lg">
              <span className="font-semibold text-slate-800">
                אוהל {tent?.code || "?"}
              </span>
              <span className="text-orange-700 font-medium">CHECK OUT / לניקוי</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DraftTentDetails({ draftAllocations, tentsMap, neighborhoodsMap }) {
  const byNeighborhood = {};
  draftAllocations.forEach(a => {
    const nid = a.neighborhood_id || "__none__";
    if (!byNeighborhood[nid]) byNeighborhood[nid] = [];
    byNeighborhood[nid].push(a);
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        שיבוץ לפי אוהלים טרם אושר — יש לאשר בטאב שיבוץ לינה
      </div>
      {Object.entries(byNeighborhood).map(([nid, allocs]) => {
        const hood = neighborhoodsMap[nid];
        const total = allocs.reduce((s, a) => s + (a.allocated_pax || 0), 0);
        return (
          <div key={nid} className="border border-amber-200 bg-amber-50/40 rounded-xl p-3 space-y-1">
            <p className="font-bold text-sm text-slate-800">{hood?.name || "שכונה לא ידועה"}</p>
            <div className="space-y-1">
              {allocs.map(a => {
                const tent = tentsMap[a.tent_id];
                return (
                  <div key={a.id} className="flex items-center justify-between text-xs text-slate-600">
                    <span className="font-medium">אוהל {tent?.code || "?"}</span>
                    <span>{a.allocated_pax} מיטות (טיוטה)</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-amber-600 font-medium">סה״כ: {total} אנשים · {allocs.length} אוהלים</p>
          </div>
        );
      })}
    </div>
  );
}

function NeighborhoodOnlyDetails({ nhoodReservations, neighborhoodsMap, profile, type }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        שיבוץ אזורי בלבד — טרם נבחרו אוהלים ספציפיים
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {nhoodReservations.map(res => (
          <NeighborhoodOnlyCard
            key={res.id}
            reservation={res}
            neighborhood={neighborhoodsMap[res.neighborhood_id]}
            profile={profile}
            type={type}
          />
        ))}
      </div>
    </div>
  );
}