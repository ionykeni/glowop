import { AlertTriangle } from "lucide-react";

// Persistent in-form status for a partially completed or unverifiable Quote save.
export default function QuoteSaveRecoveryBanner({ recovery }) {
  if (!recovery) return null;
  const ambiguous = recovery.kind === "ambiguous";
  return (
    <div role="alert" className={`rounded-xl border px-3 py-2.5 text-xs space-y-1 ${ambiguous ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        {ambiguous ? "לא ניתן לאמת אם השמירה הצליחה" : recovery.quoteSaved ? "הצעת המחיר נשמרה" : "הקבוצה נוצרה, הצעת המחיר עדיין לא נשמרה"}
      </div>
      <p>{recovery.message}</p>
      <p className="font-medium">
        {ambiguous
          ? "אין ללחוץ שוב על שמירה. סגרו את הטופס ובדקו ברשימת ההצעות אם ההצעה נוצרה לפני יצירה מחדש."
          : "ניתן ללחוץ על \"המשך שמירה\" — הפעולה תשלים רק את השלבים החסרים, ללא יצירת הצעה או קבוצה נוספת."}
      </p>
    </div>
  );
}