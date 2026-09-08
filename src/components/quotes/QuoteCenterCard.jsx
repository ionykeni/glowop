import { useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Users, FileText, Pencil, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import QuoteStatusBadge from "@/components/quotes/QuoteStatusBadge";
import QuotePdfButton from "@/components/quotes/QuotePdfButton";
import QuoteOptionApprovalDialog from "@/components/quotes/QuoteOptionApprovalDialog";
import QuoteDeleteButton from "@/components/quotes/QuoteDeleteButton";
import RoleGate from "@/components/RoleGate";
import { getQuoteNights } from "@/lib/quotePricing";

const money = value => `₪${Math.round(Number(value) || 0).toLocaleString("he-IL")}`;

function QuotePriceBlock({ quote, pricing }) {
  if (pricing?.error) return <span className="text-destructive">לא ניתן לטעון מחירי אפשרויות</span>;
  if (pricing?.kind === "multi") return <span className="grid gap-0.5 text-primary"><span>אפשרות א׳: {money(pricing.A)}{quote.approved_option_key === "A" ? " · נבחרה" : ""}</span><span>אפשרות ב׳: {money(pricing.B)}{quote.approved_option_key === "B" ? " · נבחרה" : ""}</span></span>;
  if (pricing?.kind === "single") return <span className="text-primary">סה״כ: {money(pricing.A)}</span>;
  return <span className="text-primary">סה״כ: {money(quote.total_price)}</span>;
}

export default function QuoteCenterCard({ quote, group, profile, optionPricing, canDecide, onEdit, onApprove, onReject, onDeleted }) {
  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const nights = getQuoteNights(quote.arrival_date, quote.departure_date, quote.quote_type);
  return <div className="bg-card border border-border rounded-xl p-4 space-y-3" dir="rtl">
    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{quote.client_name || group?.group_name || "ללא שם"}</p><p className="text-xs text-muted-foreground">{quote.quote_number || `גרסה ${quote.version}`}</p></div><QuoteStatusBadge status={quote.status} /></div>
    <div className="flex flex-wrap items-start gap-3 text-xs text-muted-foreground">{quote.arrival_date && <span className="flex gap-1"><Calendar className="w-3 h-3" />{quote.arrival_date}{quote.departure_date ? ` — ${quote.departure_date}` : ""}</span>}{quote.quote_type !== "day_use" && nights > 0 && <span>לילות: {nights}</span>}<span className="flex gap-1"><Users className="w-3 h-3" />{quote.estimated_pax || 0}</span><QuotePriceBlock quote={quote} pricing={optionPricing} /></div>
    <div className="text-xs text-muted-foreground">קבוצה: {group ? `${group.group_name} · ${group.status}` : "לא נוצרה"} · פרופיל: {profile ? "קיים" : "חסר"} · עודכן {quote.updated_date?.slice(0, 10) || "—"}</div>
    <div className="flex flex-wrap gap-2">{group && <Button asChild size="sm" variant="outline"><Link to={`/groups/${group.id}`}><FileText className="w-3.5 h-3.5" />פתח קבוצה</Link></Button>}<QuotePdfButton quote={quote} group={group} /><RoleGate permission="EDIT_QUOTE"><Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="w-3.5 h-3.5" />עריכה</Button></RoleGate><QuoteDeleteButton quote={quote} onDeleted={onDeleted} />{canDecide && ["DRAFT","SENT"].includes(quote.status) && <><Button size="sm" onClick={() => quote.multi_option_enabled ? setOptionDialogOpen(true) : onApprove("A")}><CheckCircle className="w-3.5 h-3.5" />אשר הצעה</Button><Button size="sm" variant="destructive" onClick={onReject}><XCircle className="w-3.5 h-3.5" />דחייה</Button></>}</div>
    <QuoteOptionApprovalDialog quote={quote} open={optionDialogOpen} onClose={() => setOptionDialogOpen(false)} onConfirm={async key => { const success = await onApprove(key); if (success === false) throw new Error("APPROVAL_FAILED"); setOptionDialogOpen(false); }} />
  </div>;
}