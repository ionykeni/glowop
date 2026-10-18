export default function ReportSummaryBar({ expected, totals }) {
  const diff = totals.total - expected;
  const items = [
    { label: "צפוי (רשמי)", value: expected, cls: "text-foreground" },
    { label: "בנים", value: totals.boys, cls: "text-primary" },
    { label: "בנות", value: totals.girls, cls: "text-pink-600" },
    { label: "סה״כ דווח", value: totals.total, cls: "text-foreground" },
    { label: "הפרש", value: `${diff > 0 ? "+" : ""}${diff}`, cls: diff === 0 ? "text-emerald-600" : "text-orange-600" },
  ];
  return (
    <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
      {items.map(i => (
        <div key={i.label} className="bg-card border border-border rounded-xl px-1 py-2 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">{i.label}</p>
          <p className={`text-lg sm:text-2xl font-bold ${i.cls}`}>{i.value}</p>
        </div>
      ))}
    </div>
  );
}