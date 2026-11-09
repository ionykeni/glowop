import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import QuoteStatusBadge from "./QuoteStatusBadge";
import ApprovalCapacityDialog from "./ApprovalCapacityDialog";
import QuoteOptionApprovalDialog from "./QuoteOptionApprovalDialog";
import RoleGate from "@/components/RoleGate";
import { useRoleContext } from "@/lib/RoleContext";
import { isQuoteMultiOptionEnabled } from "@/lib/quoteMultiOption";
import { updateQuotePreparationCache, invalidateQuotePreparationCache } from "@/lib/quotePreparationCache";

/**
 * Allowed transitions per the documented quote lifecycle:
 *  DRAFT  → SENT
 *  SENT   → APPROVED | REJECTED | EXPIRED
 */
const TRANSITIONS = {
  DRAFT: [
    { next: "SENT",     label: "סמן כנשלח",   icon: Send,         variant: "outline" },
  ],
  SENT: [
    { next: "APPROVED", label: "אשר הצעה",     icon: CheckCircle,  variant: "default"     },
    { next: "REJECTED", label: "דחה הצעה",     icon: XCircle,      variant: "destructive" },
    { next: "EXPIRED",  label: "פג תוקף",      icon: Clock,        variant: "outline"     },
  ],
};

/**
 * Build the snapshot captured at APPROVED time.
 * Contains the commercial truth for the guest-form flow later.
 */
function buildSnapshot(quote, group) {
  // Calculate nights from stored dates (quote.nights field is never persisted)
  const calcedNights = (() => {
    if (!quote.arrival_date || !quote.departure_date) return 0;
    return Math.max(0, Math.round((new Date(quote.departure_date) - new Date(quote.arrival_date)) / 86400000));
  })();

  return JSON.stringify({
    capturedAt:    new Date().toISOString(),
    // group context
    groupName:     group?.group_name     || "",
    groupType:     group?.group_type     || "",
    startDate:     quote.arrival_date    || "",
    endDate:       quote.departure_date  || "",
    nights:        calcedNights,
    // headcounts
    totalPax:      quote.estimated_pax   || 0,
    staffTotal:    quote.staff_count     || 0,
    studentsTotal: quote.participant_count || 0,
    // client info
    clientName:    quote.client_name     || "",
    clientPhone:   quote.client_phone    || "",
    clientEmail:   quote.client_email    || "",
    clientTaxId:   quote.client_tax_id   || "",
    // pricing (line item detail for PDF)
    subtotal:        quote.subtotal        || 0,
    discount_type:    quote.discount_type || "PERCENT",
    discount_percent: quote.discount_percent || 0,
    discount_amount: quote.discount_amount  || 0,
    total_price:     quote.total_price      || 0,
    advance_payment: quote.advance_payment  || 0,
    balance_payment: quote.balance_payment  || 0,
  });
}

export default function QuoteStatusActions({ quote, group, onUpdated }) {
  const { role } = useRoleContext();
  const queryClient = useQueryClient();
  const multiOptionEnabled = isQuoteMultiOptionEnabled(role);
  const [loading, setLoading] = useState(false);
  const [capacityWarnings, setCapacityWarnings] = useState(null); // non-null = dialog open
  const [pendingApproval, setPendingApproval] = useState(false);
  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const [approvalOptionKey, setApprovalOptionKey] = useState(null);

  const transitions = (TRANSITIONS[quote.status] || []).filter(item => !(item.next === "APPROVED" && quote.multi_option_enabled && !multiOptionEnabled));
  if (transitions.length === 0) return null;

  const doApprove = async (overrideWarning, overrideReason, selectedOptionKey = approvalOptionKey) => {
    setLoading(true);
    setCapacityWarnings(null);

    // ── Safe approval + operational initialization (backend owns this) ──────
    // The backend function approves the Quote ONLY after Group + exactly one
    // OperationalGroupProfile are guaranteed. The frontend no longer updates
    // Quote.status directly.
    let approveRes;
    try {
      approveRes = await base44.functions.invoke(quote.preparation_flow_enabled ? "approveQuoteAndActivateGroup" : "approveQuoteAndInitializeGroup", { quote_id: quote.id, selected_option_key: selectedOptionKey || undefined });
    } catch (invokeErr) {
      console.error("[QuoteStatusActions] approveQuoteAndInitializeGroup invoke failed:", invokeErr?.message);
      toast.error("אישור הצעת המחיר נכשל");
      setLoading(false);
      return false;
    }

    const data = approveRes?.data || {};
    if (!data.success) {
      // Log any returned IDs for admin/debug, but keep the user message clean
      if (data.group_id || data.operational_group_profile_id) {
        console.error("[QuoteStatusActions] approval error", data.error, {
          group_id: data.group_id,
          operational_group_profile_id: data.operational_group_profile_id,
        });
      }
      const ERROR_MESSAGES = {
        UNAUTHORIZED: "אין הרשאה לאשר הצעת מחיר",
        FORBIDDEN: "אין הרשאה לאשר הצעת מחיר",
        QUOTE_NOT_FOUND: "הצעת המחיר לא נמצאה",
        QUOTE_GROUP_LINK_BROKEN: "ההצעה מקושרת לקבוצה שלא קיימת — נדרשת בדיקת מנהל",
        MULTIPLE_OPERATIONAL_PROFILES: "נמצאו מספר פרופילים תפעוליים לקבוצה — נדרשת בדיקת מנהל",
        MULTIPLE_OPERATIONAL_PROFILES_AFTER_CREATE: "נמצאו מספר פרופילים תפעוליים לקבוצה — נדרשת בדיקת מנהל",
        OGP_CREATE_FAILED_AFTER_GROUP: "הקבוצה נוצרה/קיימת אך יצירת הפרופיל התפעולי נכשלה — יש לפנות למנהל מערכת",
        QUOTE_LINK_UPDATE_FAILED: "קישור ההצעה לקבוצה/פרופיל נכשל — ההצעה לא אושרה",
        QUOTE_APPROVAL_UPDATE_FAILED: "הפרופיל התפעולי מוכן אך עדכון סטטוס ההצעה נכשל — נסה שוב",
        SELECTED_OPTION_REQUIRED: "יש לבחור אפשרות מאושרת",
        QUOTE_ALREADY_APPROVED_WITH_DIFFERENT_OPTION: "ההצעה כבר אושרה עם אפשרות אחרת",
        INVALID_QUOTE_OPERATIONAL_DATE: "תאריכי הצעת המחיר אינם תקינים. יש לתקן את ההצעה לפני העברה לתפעול.",
      };
      toast.error(ERROR_MESSAGES[data.error] || "אישור הצעת המחיר נכשל");
      setLoading(false);
      return false;
    }

    // ── Success — show non-blocking warnings if any ─────────────────────────
    const WARNING_MESSAGES = {
      QUOTE_GROUP_CONTACT_DIFFER: "פרטי איש הקשר בהצעה שונים מהקבוצה — לא בוצע שינוי אוטומטי",
      QUOTE_GROUP_DATES_DIFFER: "התאריכים בהצעה שונים מהקבוצה — לא בוצע שינוי אוטומטי",
      QUOTE_OGP_PAX_DIFFER: "מספרי המשתתפים בהצעה שונים מהפרופיל התפעולי — לא בוצע שינוי אוטומטי",
      QUOTE_OGP_LINK_DIFFERS: "הפרופיל התפעולי מקושר להצעה אחרת — נדרשת בדיקת מנהל",
      APPROVED_QUOTE_REPAIRED_OPERATIONAL_INIT: "ההצעה הייתה מאושרת — הושלמה אתחול הקבוצה/הפרופיל התפעולי",
    };
    (data.warnings || []).forEach(w => toast.warning(WARNING_MESSAGES[w] || w));

    const targetGroupId = data.group?.id;
    updateQuotePreparationCache(queryClient, { quote: data.quote, group: data.group, profile: data.profile });
    invalidateQuotePreparationCache(queryClient, targetGroupId);

    if (quote.preparation_flow_enabled) {
      toast.success("הצעת המחיר אושרה");
      setLoading(false);
      onUpdated();
      return true;
    }

    toast.success("הצעת המחיר אושרה");
    setLoading(false);
    onUpdated();
    return true;
  };

  const handleTransition = async (nextStatus, selectedOptionKey = null) => {
    if (nextStatus !== "APPROVED") {
      setLoading(true);
      let updatedQuote;
      if (quote.preparation_flow_enabled && nextStatus === "REJECTED") {
        const reason = window.prompt("סיבת דחייה");
        if (!reason) { setLoading(false); return; }
        const response = await base44.functions.invoke("rejectQuotePreparation", { quote_id: quote.id, rejection_reason: reason });
        if (!response.data?.success) { setLoading(false); toast.error("דחיית ההצעה נכשלה"); return; }
        updatedQuote = { ...quote, status: "REJECTED", rejection_reason: reason };
      } else {
        updatedQuote = await base44.entities.Quote.update(quote.id, { status: nextStatus });
      }
      updateQuotePreparationCache(queryClient, { quote: updatedQuote, group });
      invalidateQuotePreparationCache(queryClient, quote.group_id || group?.id);
      setLoading(false);
      onUpdated();
      return;
    }

    if (quote.multi_option_enabled && !selectedOptionKey) {
      setOptionDialogOpen(true);
      return;
    }
    if (selectedOptionKey) setApprovalOptionKey(selectedOptionKey);
    // Approval: run capacity check first
    setPendingApproval(true);
    let result;
    try {
      const res = await base44.functions.invoke("checkSiteAvailability", {
        arrival_date: quote.arrival_date, departure_date: quote.departure_date || quote.arrival_date,
        total_pax: Number(quote.estimated_pax) || 0, group_type: group?.group_type || "LODGING",
        includes_meals: (group?.group_type || "LODGING") === "LODGING", exclude_quote_id: quote.id,
      });
      const warnings = res.data?.warnings || [];
      if (warnings.length > 0) setCapacityWarnings(warnings);
      else result = await doApprove(false, "", selectedOptionKey);
    } catch {
      result = await doApprove(false, "", selectedOptionKey);
    } finally {
      setPendingApproval(false);
    }
    return result;
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <QuoteStatusBadge status={quote.status} />
        <RoleGate permission="APPROVE_QUOTE">
          {transitions.map(({ next, label, icon: Icon, variant }) => (
            <Button
              key={next}
              size="sm"
              variant={variant}
              disabled={loading || pendingApproval}
              onClick={() => handleTransition(next)}
              className="gap-1.5 text-xs h-7"
            >
              <Icon className="w-3.5 h-3.5" />
              {pendingApproval && next === "APPROVED" ? "בודק..." : label}
            </Button>
          ))}
        </RoleGate>
      </div>

      <QuoteOptionApprovalDialog
        quote={quote}
        open={optionDialogOpen}
        onClose={() => setOptionDialogOpen(false)}
        onConfirm={async (key) => { const success = await handleTransition("APPROVED", key); if (success === false) throw new Error("APPROVAL_FAILED"); setOptionDialogOpen(false); }}
      />

      {capacityWarnings && (
        <ApprovalCapacityDialog
          warnings={capacityWarnings}
          onConfirm={(reason) => doApprove(true, reason, approvalOptionKey)}
          onCancel={() => setCapacityWarnings(null)}
        />
      )}
    </>
  );
}