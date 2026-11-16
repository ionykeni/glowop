import { ClipboardCheck } from "lucide-react";
import { periodText, monthLabel } from "@/lib/preventiveMaintenanceLabels";

const TABS = [
  { id: "tasks", label: "משימות" },
  { id: "history", label: "היסטוריה" },
  { id: "settings", label: "הגדרות", managerOnly: true },
];

export default function PmHeader({ data, tab, onTab, isManager }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">תחזוקה שוטפת</h1>
          {data && (
            <p className="text-xs text-muted-foreground">
              שבוע {periodText(data.week.start, data.week.end)} · {monthLabel(data.month.start)}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-1 bg-muted rounded-xl p-1">
        {TABS.filter((t) => !t.managerOnly || isManager).map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}