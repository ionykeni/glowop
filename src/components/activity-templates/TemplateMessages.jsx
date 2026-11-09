export default function TemplateMessages({ errors = [], warnings = [], notice = "" }) {
  if (!errors.length && !warnings.length && !notice) return null;
  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 space-y-0.5">
          {errors.map((e, i) => <p key={i}>{e.message}</p>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5">
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}
      {notice && <p className="text-sm text-green-700">{notice}</p>}
    </div>
  );
}