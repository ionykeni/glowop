import TemplateStatusBadge from "./TemplateStatusBadge";

export default function VersionSelector({ versions, selectedId, onSelect }) {
  return (
    <div className="flex flex-wrap gap-2">
      {versions.map(v => (
        <button key={v.id} onClick={() => onSelect(v.id)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
            v.id === selectedId ? "border-primary bg-primary/5 text-primary font-semibold" : "border-slate-200 bg-white text-slate-600 hover:border-primary/40"
          }`}>
          גרסה {v.version}
          <TemplateStatusBadge status={v.status} />
        </button>
      ))}
    </div>
  );
}