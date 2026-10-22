import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";

const REASONS = [
  { key: "CUSTOMER_CANCELLED", label: "הקבוצה ביטלה את ההזמנה", effect: "הקבוצה תסומן כמבוטלת ומשאבים עתידיים ישוחררו. ההיסטוריה וההצעה המאושרת יישמרו." },
  { key: "CREATED_BY_MISTAKE", label: "ההצעה נוצרה בטעות", effect: "רק ההצעה הזו תוסר. נתונים תפעוליים לא ישתנו." },
];

export default function QuoteCancelDialog({ quote, open, onOpenChange, onDone }) {
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState(null);
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreview(null); setReason(null); setDeclared(false); setMessage("");
    base44.functions.invoke("previewQuoteBookingCancellation", { quote_id: quote.id }).then(r => setPreview(r.data));
  }, [open, quote.id]);

  const needsDeclaration = !!reason && preview?.reasons?.[reason]?.requires_no_arrival_declaration === true;
  const confirm = async () => {
    setBusy(true);
    const { data } = await base44.functions.invoke("commitQuoteCancellation", { quote_id: quote.id, reason, fingerprint: preview.fingerprint, no_arrival_declared: declared });
    setBusy(false);
    if (data.success) { onDone?.(); onOpenChange(false); } else setMessage(data.message || "לא ניתן לבצע כרגע.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader><DialogTitle>ביטול / הסרה</DialogTitle></DialogHeader>
        {!preview ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (
          <div className="space-y-3">
            {REASONS.map(r => <Button key={r.key} variant={reason === r.key ? "default" : "outline"} className="w-full justify-start" onClick={() => setReason(r.key)}>{r.label}</Button>)}
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