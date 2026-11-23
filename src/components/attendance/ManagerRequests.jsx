import { Loader2, Inbox } from "lucide-react";
import { useManagerRequests } from "@/hooks/useAttendance";
import RequestCard from "./RequestCard";

// בקשות תיקון שעות — manager approval queue.
export default function ManagerRequests() {
  const { data, isLoading, isFetching, error } = useManagerRequests();
  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  return (
    <div className={`space-y-3 ${isFetching ? "opacity-60" : ""}`}>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <p className="px-4 py-2 text-sm font-bold bg-muted/40 border-b border-border">ממתינות לאישור ({data.pending.length})</p>
        {data.pending.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground"><Inbox className="w-7 h-7 mx-auto mb-2 opacity-30" />אין בקשות ממתינות</div>
        ) : (
          <div className="divide-y divide-border">{data.pending.map((r) => <RequestCard key={r.id} request={r} />)}</div>
        )}
      </div>
      {data.recent.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <p className="px-4 py-2 text-sm font-bold bg-muted/40 border-b border-border text-muted-foreground">החלטות אחרונות</p>
          <div className="divide-y divide-border">{data.recent.map((r) => <RequestCard key={r.id} request={r} decided />)}</div>
        </div>
      )}
    </div>
  );
}