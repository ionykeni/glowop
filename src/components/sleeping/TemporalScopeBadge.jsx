export default function TemporalScopeBadge({ scope }) {
  if (!scope?.label) return null;
  const colors = scope.tone === "continuing"
    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
    : "border-blue-200 bg-blue-50 text-blue-700";
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colors}`}>{scope.label}</span>;
}