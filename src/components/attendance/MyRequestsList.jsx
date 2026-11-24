import { useMyRequests } from "@/hooks/useAttendance";
import { fmtDay, fmtDateTime, REQUEST_TYPE_LABELS } from "@/lib/attendanceFormat";
import RequestStatusBadge from "./RequestStatusBadge";
import RequestTimes from "./RequestTimes";

// The employee's own correction requests and their outcome (ממתין לאישור / אושר / נדחה).
export default function MyRequestsList() {
  const { data } = useMyRequests();
  const requests = data?.requests || [];
  if (!requests.length) return null;
  return (
    <div className="att-card overflow-hidden">
      <p className="att-head">בקשות התיקון שלי</p>
      <div className="att-divide">
        {requests.map((r) => (
          <div key={r.id} className="px-5 py-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{REQUEST_TYPE_LABELS[r.request_type]} · {fmtDay(r.local_date)}</p>
                <p className="text-[11px] text-muted-foreground">נשלח {fmtDateTime(r.requested_at)}</p>
              </div>
              <RequestStatusBadge status={r.status} />
            </div>
            <RequestTimes request={r} />
            {r.decided_at && <p className="text-[11px] text-muted-foreground">{r.status === "APPROVED" ? "אושר" : "נדחה"} ע״י {r.decided_by_name} · {fmtDateTime(r.decided_at)}{r.decision_note && ` — ${r.decision_note}`}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}