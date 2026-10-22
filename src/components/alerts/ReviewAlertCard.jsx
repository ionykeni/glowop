/**
 * ReviewAlertCard
 * Renders a single OperationalReviewAlert with acknowledge button.
 * For GROUP_PAX_CHANGED + KITCHEN: shows extra "update meal pax" action.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { acknowledgeAlert } from "@/lib/reviewAlerts";
import { useRoleContext } from "@/lib/RoleContext";
import { format } from "date-fns";
import { toast } from "sonner";
import { groupDatesLabel } from "@/lib/groupDatesLabel";

// Which roles can acknowledge which modules
const MODULE_ACK_ROLES = {
  KITCHEN:               ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "KITCHEN"],
  HOUSEKEEPING:          ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "HOUSEKEEPING_MANAGER", "HOUSEKEEPING_STAFF"],
  ALLOCATION:            ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "HOUSEKEEPING_MANAGER"],
  SLEEPING_REQUIREMENTS: ["SUPER_ADMIN", "ADMIN", "OPERATIONS"],
  GROUP:                 ["SUPER_ADMIN", "ADMIN", "OPERATIONS"],
  ACTIVITIES:            ["SUPER_ADMIN", "ADMIN", "OPERATIONS"],
  REPORTS:               ["SUPER_ADMIN", "ADMIN"],
};

function canAcknowledge(role, module) {
  if (!role) return false;
  return (MODULE_ACK_ROLES[module] || ["SUPER_ADMIN", "ADMIN"]).includes(role);
}

export const MODULE_LABELS = {
  KITCHEN:               "מטבח",
  HOUSEKEEPING:          "משק בית",
  ALLOCATION:            "שיבוץ לינה",
  SLEEPING_REQUIREMENTS: "דרישות לינה",
  GROUP:                 "קבוצה",
  ACTIVITIES:            "פעילויות",
  REPORTS:               "דוחות",
};

const SEVERITY_STYLES = {
  CRITICAL: "bg-red-50 border-red-300",
  WARNING:  "bg-amber-50 border-amber-300",
  INFO:     "bg-blue-50 border-blue-200",
};
const SEVERITY_TEXT = {
  CRITICAL: "text-red-700",
  WARNING:  "text-amber-800",
  INFO:     "text-blue-700",
};

/**
 * Parse the new_value_json to extract pax values.
 * Returns { oldPax, newPax, diff } or null.
 */
function parsePaxChange(alert) {
  try {
    const prev = alert.previous_value_json ? JSON.parse(alert.previous_value_json) : null;
    const next  = alert.new_value_json      ? JSON.parse(alert.new_value_json)      : null;
    if (!prev || !next) return null;
    const oldPax = Number(prev.total_pax ?? prev.pax ?? 0);
    const newPax = Number(next.total_pax ?? next.pax ?? 0);
    if (!oldPax && !newPax) return null;
    return { oldPax, newPax, diff: newPax - oldPax };
  } catch {
    return null;
  }
}

export default function ReviewAlertCard({ alert, groupName, group, onAcknowledged }) {
  const { role } = useRoleContext();
  const datesLabel = groupDatesLabel(group);
  const [acking, setAcking]         = useState(false);
  const [updating, setUpdating]     = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);

  const canAck   = canAcknowledge(role, alert.module);
  const styles   = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.WARNING;
  const textColor = SEVERITY_TEXT[alert.severity]  || SEVERITY_TEXT.WARNING;

  // Kitchen PAX update action — only for KITCHEN + GROUP_PAX_CHANGED
  const isKitchenPaxAlert = alert.module === "KITCHEN" && alert.source === "GROUP_PAX_CHANGED";
  const paxChange = isKitchenPaxAlert ? parsePaxChange(alert) : null;
  const canUpdateMeals = isKitchenPaxAlert && !!paxChange && canAck;

  const doAcknowledge = async (showToast = true) => {
    const me = await base44.auth.me();
    await acknowledgeAlert(alert.id, me?.email || me?.full_name || role);
    if (showToast) toast.success("ההתראה סומנה כטופלה");
    onAcknowledged?.();
  };

  const handleAcknowledge = async () => {
    setAcking(true);
    try {
      await doAcknowledge(true);
    } catch {
      toast.error("שגיאה באישור ההתראה");
    } finally {
      setAcking(false);
    }
  };

  const handleUpdateMeals = async () => {
    if (!paxChange) return;
    setUpdating(true);
    try {
      // Server updates pax only on the Group's active meals — never date, type, notes, diets, sandwich
      const result = await opWrite.applyKitchenPaxAlert(alert.id);
      // Acknowledge after update
      await doAcknowledge(false);
      toast.success(`עודכנו ${result?.meals ?? 0} ארוחות לפי מספר האנשים החדש (${result?.pax ?? paxChange.newPax})`);
    } catch (err) {
      toast.error(err?.message || "שגיאה בעדכון הארוחות");
    } finally {
      setUpdating(false);
      setConfirmUpdate(false);
    }
  };

  const createdAt = alert.created_date
    ? (() => { try { return format(new Date(alert.created_date), "dd/MM/yyyy HH:mm"); } catch { return ""; } })()
    : "";

  // Build enhanced message for pax changes
  const renderMessage = () => {
    if (paxChange) {
      const { oldPax, newPax, diff } = paxChange;
      const diffLine = diff > 0
        ? `נוספו ${diff} אנשים.`
        : diff < 0
        ? `ירדו ${Math.abs(diff)} אנשים.`
        : "";
      return (
        <div className={`text-xs leading-relaxed space-y-0.5 ${textColor}`}>
          <p>מספר האנשים בקבוצה השתנה מ-{oldPax} ל-{newPax}.</p>
          {diffLine && <p className="font-semibold">{diffLine}</p>}
        </div>
      );
    }
    return <p className={`text-xs leading-relaxed ${textColor}`}>{alert.message}</p>;
  };

  return (
    <div className={`rounded-xl border-2 px-4 py-3 space-y-2 ${styles}`} dir="rtl">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${textColor}`} />
          <div className="min-w-0">
            <p className={`text-sm font-bold leading-snug ${textColor}`}>{alert.title}</p>
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
              alert.severity === "CRITICAL" ? "bg-red-100 text-red-700" :
              alert.severity === "INFO"     ? "bg-blue-100 text-blue-700" :
              "bg-amber-100 text-amber-700"
            }`}>
              {MODULE_LABELS[alert.module] || alert.module} — דורש בדיקה
            </span>
          </div>
        </div>
        {/* Acknowledge button (shown when no pax-update UI is active) */}
        {canAck && !canUpdateMeals && (
          <Button
            size="sm" variant="outline" disabled={acking}
            onClick={handleAcknowledge}
            className={`shrink-0 text-xs gap-1 ${
              alert.severity === "CRITICAL"
                ? "border-red-300 text-red-700 hover:bg-red-50"
                : "border-amber-400 text-amber-700 hover:bg-amber-100"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {acking ? "מאשר..." : "ראיתי וטיפלתי"}
          </Button>
        )}
      </div>

      {/* Group name */}
      {groupName && (
        <p className={`text-xs font-semibold ${textColor}`}>קבוצה: {groupName}</p>
      )}

      {/* Group stay/activity dates */}
      {datesLabel && (
        <p className={`text-xs ${textColor}`}>{datesLabel}</p>
      )}

      {/* Message */}
      {renderMessage()}

      {/* Kitchen PAX update actions */}
      {canUpdateMeals && !confirmUpdate && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => setConfirmUpdate(true)}
            className="gap-1 bg-amber-600 hover:bg-amber-700 text-white text-xs"
          >
            <RefreshCw className="w-3 h-3" />
            עדכן מנות לפי מספר האנשים החדש
          </Button>
          <Button
            size="sm" variant="outline" disabled={acking}
            onClick={handleAcknowledge}
            className="gap-1 border-amber-400 text-amber-700 hover:bg-amber-100 text-xs"
          >
            <CheckCircle2 className="w-3 h-3" />
            {acking ? "מאשר..." : "סמן כטופל בלי שינוי"}
          </Button>
        </div>
      )}

      {/* Confirmation dialog */}
      {canUpdateMeals && confirmUpdate && paxChange && (
        <div className="bg-white border border-amber-300 rounded-lg px-3 py-2.5 space-y-2">
          <p className="text-xs font-semibold text-amber-800">
            לעדכן את מנות הארוחות של הקבוצה מ-{paxChange.oldPax} ל-{paxChange.newPax}?
          </p>
          <p className="text-[11px] text-amber-700">
            רק כמות המנות תתעדכן. תאריכים, סוג ארוחה, הערות ודיאטות לא ישתנו.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="gap-1 bg-amber-600 hover:bg-amber-700 text-white text-xs"
              disabled={updating}
              onClick={handleUpdateMeals}
            >
              {updating ? "מעדכן..." : "כן, עדכן"}
            </Button>
            <Button
              size="sm" variant="outline"
              className="text-xs border-slate-300"
              disabled={updating}
              onClick={() => setConfirmUpdate(false)}
            >
              ביטול
            </Button>
          </div>
        </div>
      )}

      {/* Footer */}
      {createdAt && (
        <p className="text-[11px] text-slate-400 flex items-center gap-1">
          <Clock className="w-3 h-3" /> {createdAt}
        </p>
      )}
    </div>
  );
}