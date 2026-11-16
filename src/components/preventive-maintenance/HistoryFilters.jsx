const field = "h-10 w-full rounded-lg border border-input bg-card px-2 text-sm";

function Field({ label, className = "", children }) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export default function HistoryFilters({ filters, onChange, options, onReset }) {
  const set = (k, v) => onChange({ ...filters, [k]: v, ...(k === "task_id" ? { unit_key: "" } : {}) });
  const tasks = options?.tasks || [];
  const units = filters.task_id
    ? tasks.find((t) => t.id === filters.task_id)?.units || []
    : [...new Map(tasks.flatMap((t) => t.units).map((u) => [u.unit_key, u])).values()];
  const active = Object.values(filters).some(Boolean);

  return (
    <div className="rounded-2xl border border-border bg-card p-3 grid grid-cols-2 gap-2">
      <Field label="משימה" className="col-span-2">
        <select className={field} value={filters.task_id} onChange={(e) => set("task_id", e.target.value)}>
          <option value="">כל המשימות</option>
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </Field>
      <Field label="שכונה / יחידה">
        <select className={field} value={filters.unit_key} onChange={(e) => set("unit_key", e.target.value)} disabled={!units.length}>
          <option value="">הכל</option>
          {units.map((u) => <option key={u.unit_key} value={u.unit_key}>{u.label}</option>)}
        </select>
      </Field>
      <Field label="עובד/ת">
        <select className={field} value={filters.worker_user_id} onChange={(e) => set("worker_user_id", e.target.value)}>
          <option value="">כולם</option>
          {(options?.workers || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="מתאריך">
        <input type="date" className={field} value={filters.from} onChange={(e) => set("from", e.target.value)} />
      </Field>
      <Field label="עד תאריך">
        <input type="date" className={field} value={filters.to} onChange={(e) => set("to", e.target.value)} />
      </Field>
      <Field label="סטטוס">
        <select className={field} value={filters.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">הכל</option>
          <option value="VALID">תקין</option>
          <option value="VOIDED">בוטל</option>
        </select>
      </Field>
      <div className="flex items-end">
        {active && (
          <button onClick={onReset} className="h-10 w-full rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
            נקה סינון
          </button>
        )}
      </div>
    </div>
  );
}