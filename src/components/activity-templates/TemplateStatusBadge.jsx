export default function TemplateStatusBadge({ status }) {
  const ready = status === "READY";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
      ready ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-100 text-slate-600 border-slate-200"
    }`}>
      {ready ? "מוכנה" : "טיוטה"}
    </span>
  );
}