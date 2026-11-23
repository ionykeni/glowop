import { Timer } from "lucide-react";

export default function AttendanceHeader({ tabs, tab, onTab }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Timer className="w-5 h-5 text-primary" /></div>
        <h1 className="text-xl font-bold">שעון נוכחות</h1>
      </div>
      {tabs.length > 1 && (
        <div className="flex gap-1 bg-muted rounded-xl p-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => onTab(t.id)}
              className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}