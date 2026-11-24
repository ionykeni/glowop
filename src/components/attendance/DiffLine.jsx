export const TONE_TEXT = { good: "text-emerald-700", bad: "text-red-600", warn: "text-amber-700", neutral: "text-muted-foreground" };
export const TONE_PILL = { good: "bg-emerald-50 text-emerald-700 ring-emerald-200/70", bad: "bg-red-50 text-red-600 ring-red-200/70", warn: "bg-amber-50 text-amber-700 ring-amber-200/70", neutral: "bg-cream-deep/70 text-muted-foreground ring-warm-line/60" };

// One short line: "כניסה  20 דק׳ אחרי" — the amount carries the color, the label stays quiet.
export default function DiffLine({ label, text, tone }) {
  return (
    <p className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{text}</span>
    </p>
  );
}