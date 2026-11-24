import AttendanceRow from "./AttendanceRow";

export default function ManagerSection({ title, records, tone = "text-foreground" }) {
  if (!records?.length) return null;
  return (
    <div className="att-card overflow-hidden">
      <p className={`att-head ${tone}`}>
        <span>{title}</span>
        <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-card px-2 text-xs tabular-nums ring-1 ring-warm-line/60">{records.length}</span>
      </p>
      <div className="att-divide">
        {records.map((r) => <AttendanceRow key={r.id} record={r} showWorker />)}
      </div>
    </div>
  );
}