import AttendanceRow from "./AttendanceRow";

export default function ManagerSection({ title, records, tone = "text-foreground" }) {
  if (!records?.length) return null;
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <p className={`px-4 py-2 text-sm font-bold bg-muted/40 border-b border-border ${tone}`}>{title} ({records.length})</p>
      <div className="divide-y divide-border">
        {records.map((r) => <AttendanceRow key={r.id} record={r} showWorker />)}
      </div>
    </div>
  );
}