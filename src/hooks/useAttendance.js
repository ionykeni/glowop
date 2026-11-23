import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { invokeWorkforce } from "@/lib/workforceApi";
import { useToast } from "@/components/ui/use-toast";

// The server is the source of truth: identity, timestamps and the running session all come from it.
export function useAttendanceStatus() {
  return useQuery({
    queryKey: ["attendance", "status"],
    queryFn: () => invokeWorkforce("attendanceClock", { action: "status" }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

// One click = one request id; the server deduplicates and serializes per worker.
export function useClockAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (action) => invokeWorkforce("attendanceClock", { action, request_id: crypto.randomUUID() }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
    onError: (e) => toast({ title: e.message, variant: "destructive" }),
  });
}

export function useCorrection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (payload) => invokeWorkforce("correctAttendance", { ...payload, request_id: crypto.randomUUID() }),
    onSuccess: () => toast({ title: "השעות נשמרו" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

const read = (action, extra) => invokeWorkforce("getAttendance", { action, ...extra });

export function useMyMonth(month) {
  return useQuery({ queryKey: ["attendance", "month", month], queryFn: () => read("my_month", { month }), placeholderData: keepPreviousData });
}

export function useRecordAudit(recordId) {
  return useQuery({ queryKey: ["attendance", "audit", recordId], queryFn: () => read("record_audit", { record_id: recordId }), enabled: !!recordId });
}

export function useManagerDay(filters) {
  return useQuery({ queryKey: ["attendance", "day", filters], queryFn: () => read("manager_day", { filters }), placeholderData: keepPreviousData, refetchInterval: 60_000 });
}

export function useAttendanceReport(filters) {
  return useQuery({ queryKey: ["attendance", "report", filters], queryFn: () => read("report", { filters }), placeholderData: keepPreviousData });
}