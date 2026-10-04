const TONE = {
  ok: "text-green-700",
  warn: "text-amber-700",
  bad: "text-red-700",
};

/** One compact card section: icon + title, lines, optional status line. */
export default function FeasibilitySection({ icon, title, lines = [], status, tone = "ok" }) {
  return (
    <div className="space-y-0.5 border-t border-black/5 pt-2">
      <div className="text-xs font-semibold text-slate-700">{icon} {title}</div>
      {lines.filter(Boolean).map((line, i) => (
        <div key={i} className="text-xs text-slate-600">{line}</div>
      ))}
      {status && <div className={`text-xs font-medium ${TONE[tone]}`}>{status}</div>}
    </div>
  );
}