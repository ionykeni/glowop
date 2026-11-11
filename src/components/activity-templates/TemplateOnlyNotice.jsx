import { Info } from "lucide-react";

export default function TemplateOnlyNotice() {
  return (
    <div className="activity-day-notice flex items-start gap-3 px-4 py-3">
      <Info className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-sm">תבנית בלבד — אינה יוצרת הזמנות או פעילויות בפועל</p>
        <p className="text-xs mt-0.5">מרחבים מוצעים הם המלצה בלבד. זמינות המרחבים תיבדק מחדש בעת יצירת יום פעילות.</p>
      </div>
    </div>
  );
}