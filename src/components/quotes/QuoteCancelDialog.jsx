import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";

const REASONS = [
  { key: "CUSTOMER_CANCELLED", label: "הקבוצה ביטלה את ההזמנה", effect: "הקבוצה תבוטל ושיבוצים שטרם נוצלו ישוחררו. ההצעה המאושרת וההיסטוריה יישמרו." },
  { key: "CREATED_BY_MISTAKE", label: "ההצעה נוצרה בטעות", effect: "ההצעה תוסר מהרשימות הפעילות, והקבוצה שנוצרה ממנה תבוטל ושיבוציה ישוחררו. הרשומות יישמרו בהיסטוריה." },
];

export default function QuoteCancelDialog({ quote, open, onOpenChange, onDone }) {
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState(null);
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setPreview(null); setReason(null); setDeclared(false); setMessage(""); setCanRetry(false);
    keyRef.current = crypto.randomUUID();
    base44.functions.invoke("previewQuoteBookingCancellation", { quote_id: quote.id }).then(r => setPreview(r.data), () => setMessage("לא ניתן לבדוק כרגע."));
  }, [open, quote.id]);

  const pendingOp = !!(preview?.quote?.cancellation_operation_id);
  const needsDeclaration = !!reason && preview?.reasons?.[reason]?.requires_no_arrival_declaration === true;
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    const { data } = await base44.functions.invoke("commitQuoteCancellation", { quote_id: quote.id, reason: reason || "CUSTOMER_CANCELLED", fingerprint: preview.fingerprint, no_arrival_declared: declared, idempotency_key: keyRef.current })
      .catch(e => ({ data: e?.response?.data || { message: "הפעולה נכשלה. ניתן לנסות שוב." } }));
    inFlight.current = false; setBusy(false);
    if (data?.success) { onDone?.(); setMessage(data.message); setTimeout(() => onOpenChange(false), 1500); return; }
    setCanRetry(data?.outcome === "RECOVERY_REQUIRED");
    setMessage(data?.message || "לא ניתן לבצע כרגע.");
  };

  return (
    <Dialog open={open} onOpenChange={v => !busy && onOpenChange(v)}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader><DialogTitle>ביטול / הסרה</DialogTitle></DialogHeader>
        {!preview ? (message ? <p className="text-sm text-destructive">{message}</p> : <Loader2 className="w-5 h-5 animate-spin mx-auto" />) : pendingOp || canRetry ? (
          <div className="space-y-3">
            <p className="text-sm">{message || "פעולת ביטול קודמת לא הושלמה."}</p>
            <Button className="w-full" disabled={busy} onClick={confirm}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}השלמת הפעולה</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {REASONS.map(r => <Button key={r.key} variant={reason === r.key ? "default" : "outline"} className="w-full justify-start" disabled={busy} onClick={() => setReason(r.key)}>{r.label}</Button>)}
            {reason && <p className="text-sm text-muted-foreground">{REASONS.find(r => r.key === reason).effect}</p>}
            {reason && needsDeclaration && <label className="flex items-start gap-2 text-sm"><Checkbox checked={declared} onCheckedChange={v => setDeclared(v === true)} />אני מאשר/ת שהקבוצה לא הגיעה בפועל. האישור יתועד.</label>}
            {message && <p className="text-sm text-destructive">{message}</p>}
            <Button className="w-full" variant="destructive" disabled={!reason || busy || (needsDeclaration && !declared)} onClick={confirm}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}אישור</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}