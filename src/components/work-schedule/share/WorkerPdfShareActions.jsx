import { useState } from "react";
import { Copy, Download, FileText, Loader2, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchReportPdf, downloadBlob, errorText } from "@/lib/scheduleReportClient";
import { waLink, waPhone } from "@/lib/multiWeekShare";

const canShareFile = (file) => !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

// Every step is an explicit manager click: prepare → share sheet / download → WhatsApp. Nothing is sent automatically.
export default function WorkerPdfShareActions({ workerId, phone, range, message, onCopy }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const prepare = async () => {
    setBusy(true); setError(""); setNote("");
    try {
      const { blob, filename } = await fetchReportPdf({ kind: "worker", layout: "weekly", start: range.start, end: range.end, worker_id: workerId });
      setFile(new File([blob], filename, { type: "application/pdf" }));
    } catch (err) { setError(errorText(err, "הפקת ה-PDF נכשלה")); } finally { setBusy(false); }
  };

  // Called directly from the click so the browser keeps the user gesture required by the share sheet.
  const share = async () => {
    setError(""); setNote("");
    try {
      await navigator.share({ files: [file], text: message });
      setNote("הקובץ הועבר לאפליקציה שבחרת. השליחה עצמה מתבצעת רק לאחר אישורך שם.");
    } catch (err) {
      if (err?.name !== "AbortError") setError("השיתוף נחסם בדפדפן זה. יש להוריד את ה-PDF ולצרף אותו ידנית בוואטסאפ.");
    }
  };

  const openWhatsApp = () => {
    window.open(waLink(phone, message), "_blank", "noopener");
    setNote("וואטסאפ נפתח עם טקסט ההודעה בלבד. הקובץ אינו מצורף אוטומטית – יש לצרף את ה-PDF שהורד וללחוץ שליחה.");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!file && <Button type="button" size="sm" onClick={prepare} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <FileText />} הכן PDF לעובד</Button>}
        {canShareFile(file) && <Button type="button" size="sm" onClick={share}><Share2 /> שתף PDF (WhatsApp)</Button>}
        {file && <Button type="button" size="sm" variant="outline" onClick={() => downloadBlob(file, file.name)}><Download /> הורד PDF</Button>}
        {file && waPhone(phone) && <Button type="button" size="sm" variant="outline" onClick={openWhatsApp}><MessageCircle /> פתח WhatsApp לעובד</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(message)}><Copy /> העתק הודעה</Button>
      </div>
      {file && <div className="text-xs text-slate-500">מוכן: {file.name}</div>}
      {file && !canShareFile(file) && <div className="text-xs text-slate-500">שיתוף קובץ ישיר אינו זמין בדפדפן זה – יש להוריד את ה-PDF ולצרף אותו בוואטסאפ.</div>}
      {file && phone && !waPhone(phone) && <div className="text-xs text-amber-700">מספר הטלפון בפרופיל אינו תקין לוואטסאפ.</div>}
      {note && <div className="text-xs text-emerald-700">{note}</div>}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}