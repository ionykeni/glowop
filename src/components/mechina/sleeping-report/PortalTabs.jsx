const TABS = [
  { key: "spaces", label: "בקשות מרחבים" },
  { key: "sleeping", label: "דיווח נוכחות ולינה בפועל" },
];

export default function PortalTabs({ value, onChange }) {
  return (
    <div className="flex gap-1 bg-muted rounded-xl p-1">
      {TABS.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${value === t.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}