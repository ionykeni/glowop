import { Eye } from "lucide-react";

export default function PreviewOnlyBanner() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sky-900">
      <Eye className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-sm">תצוגה מקדימה בלבד — לא נוצרו פעילויות או הזמנות</p>
        <p className="text-xs mt-0.5">הבדיקה משקפת את הרשומות הקיימות ברגע הבדיקה ואינה מבטיחה הזמנה עתידית. התבנית המקורית אינה משתנה.</p>
      </div>
    </div>
  );
}