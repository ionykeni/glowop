/**
 * quoteOperationalDiff
 * Pure comparison of a Quote against its linked Group + OperationalGroupProfile.
 * Returns the list of fields that differ. Used to warn the admin that saving a
 * Quote did NOT auto-update the operational source of truth (Group / OGP).
 *
 * This is display/logic-only — it never mutates anything.
 */
import { format } from "date-fns";
import { getEffectiveQuoteGroupName } from "@/lib/quoteAudience";

function fmtDate(d) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy"); } catch { return d; }
}

/**
 * @param {object} quote  - the (freshly saved) Quote
 * @param {object} group  - linked Group (operational identity source of truth)
 * @param {object} profile - linked OperationalGroupProfile (operational details source of truth), optional
 * @returns {Array<{label, from, to}>}
 */
export function buildQuoteOperationalDiff(quote, group, profile) {
  if (!quote || !group) return [];

  const diffs = [];

  const totalPax = Number(quote.estimated_pax || 0) || null;
  const staffCount = Number(quote.staff_count || 0) || null;
  const participantCount =
    totalPax != null && staffCount != null ? Math.max(0, totalPax - staffCount) : null;

  // ── Quote vs Group ──────────────────────────────────────────────────────
  const effectiveGroupName = getEffectiveQuoteGroupName(quote);
  const targetGroupType = quote.quote_type === "day_use" ? "DAY_USE" : quote.quote_type === "lodging" ? "LODGING" : group.group_type;
  if (effectiveGroupName !== group.group_name)
    diffs.push({ label: "שם קבוצה", from: group.group_name || "—", to: effectiveGroupName });
  if (targetGroupType !== group.group_type)
    diffs.push({ label: "סוג קבוצה", from: group.group_type || "—", to: targetGroupType });
  if (quote.contact_person && quote.contact_person !== group.contact_name)
    diffs.push({ label: "איש קשר", from: group.contact_name || "—", to: quote.contact_person });
  if (quote.client_phone && quote.client_phone !== group.contact_phone)
    diffs.push({ label: "טלפון", from: group.contact_phone || "—", to: quote.client_phone });
  if (quote.client_email && quote.client_email !== group.contact_email)
    diffs.push({ label: "אימייל", from: group.contact_email || "—", to: quote.client_email });
  if (quote.arrival_date && quote.arrival_date !== group.arrival_date)
    diffs.push({ label: "תאריך הגעה", from: fmtDate(group.arrival_date), to: fmtDate(quote.arrival_date) });
  if (quote.departure_date && quote.departure_date !== group.departure_date)
    diffs.push({ label: "תאריך עזיבה", from: fmtDate(group.departure_date), to: fmtDate(quote.departure_date) });
  if (quote.arrival_time && quote.arrival_time !== group.arrival_time)
    diffs.push({ label: "שעת הגעה", from: group.arrival_time || "—", to: quote.arrival_time });
  if (quote.departure_time && quote.departure_time !== group.departure_time)
    diffs.push({ label: "שעת יציאה", from: group.departure_time || "—", to: quote.departure_time });

  // ── Quote vs OperationalGroupProfile (falls back to Group when OGP missing) ─
  const ogpTotal   = profile ? profile.total_pax         : group.total_pax;
  const ogpStaff   = profile ? profile.staff_count       : group.staff_count;
  const ogpPartic  = profile ? profile.participant_count : group.participant_count;

  if (totalPax != null && totalPax !== ogpTotal)
    diffs.push({ label: "סה״כ משתתפים", from: ogpTotal ?? "—", to: totalPax });
  if (staffCount != null && staffCount !== ogpStaff)
    diffs.push({ label: "צוות", from: ogpStaff ?? "—", to: staffCount });
  if (participantCount != null && participantCount !== ogpPartic)
    diffs.push({ label: "חניכים", from: ogpPartic ?? "—", to: participantCount });

  return diffs;
}