import { Timer } from "lucide-react";
import SegmentedTabs from "./SegmentedTabs";

export default function AttendanceHeader({ tabs, tab, onTab }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sage text-sage-foreground"><Timer className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-bold leading-tight">שעון נוכחות</h1>
          <p className="text-xs text-muted-foreground">נוכחות, תיקונים ודוחות במקום אחד</p>
        </div>
      </div>
      {tabs.length > 1 && <SegmentedTabs tabs={tabs} value={tab} onChange={onTab} label="אזורי שעון הנוכחות" />}
    </div>
  );
}