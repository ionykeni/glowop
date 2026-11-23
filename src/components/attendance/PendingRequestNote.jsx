import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRequestAction } from "@/hooks/useAttendance";
import { REQUEST_TYPE_LABELS } from "@/lib/attendanceFormat";
import RequestTimes from "./RequestTimes";

// Shown on a record that has a correction request awaiting manager approval. The record itself is unchanged.
export default function PendingRequestNote({ request }) {
  const m = useRequestAction();
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-amber-800 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{REQUEST_TYPE_LABELS[request.request_type]} — ממתין לאישור מנהל</p>
        {request.status === "PENDING" && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={m.isPending} onClick={() => m.mutate({ action: "cancel_request", id: request.id })}>
            {m.isPending && <Loader2 className="w-3 h-3 animate-spin" />}ביטול הבקשה
          </Button>
        )}
      </div>
      <RequestTimes request={request} />
    </div>
  );
}