import { Loader2, Inbox } from "lucide-react";
import { useManagerRequests } from "@/hooks/useAttendance";
import RequestCard from "./RequestCard";

// בקשות תיקון שעות — manager approval queue.
export default function ManagerRequests() {
  const { data, isLoading, isFetching, error } = useManagerRequests();
  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  return (
    <div className={`space-y-4 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
      <div className="att-card overflow-hidden">
        <p className="att-head">
          <span>ממתינות לאישור</span>
          {data.pending.length > 0 && <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-red-500 px-2 text-xs font-bold text-white tabular-nums">{data.pending.length}</span>}
        </p>
        {data.pending.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sage text-sage-foreground"><Inbox className="h-6 w-6" /></span>
            אין בקשות ממתינות
          </div>
        ) : (
          <div className="att-divide">{data.pending.map((r) => <RequestCard key={r.id} request={r} />)}</div>
        )}
      </div>
      {data.recent.length > 0 && (
        <div className="att-card overflow-hidden">
          <p className="att-head text-muted-foreground">החלטות אחרונות</p>
          <div className="att-divide">{data.recent.map((r) => <RequestCard key={r.id} request={r} decided />)}</div>
        </div>
      )}
    </div>
  );
}