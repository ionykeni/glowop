import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeWorkforce } from "@/lib/workforceApi";
import { useToast } from "@/components/ui/use-toast";

const refreshAll = (qc) => Promise.all(["pm-overview", "pm-history"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

// Read-only: opening the page never creates records.
export function usePmOverview() {
  return useQuery({
    queryKey: ["pm-overview"],
    queryFn: () => invokeWorkforce("getPreventiveMaintenance", { action: "overview" }),
    staleTime: 30_000,
  });
}

export function usePmHistory(filters) {
  return useQuery({
    queryKey: ["pm-history", filters],
    queryFn: () => invokeWorkforce("getPreventiveMaintenance", { action: "history", filters }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// Manager-only: previous weekly occurrences, including weeks that were not completed.
export function usePmWeeklyHistory(filters) {
  return useQuery({
    queryKey: ["pm-history", "weeks", filters],
    queryFn: () => invokeWorkforce("getPreventiveMaintenance", { action: "weekly_history", filters }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// One click = one request id; the server dedupes retries and repeated clicks.
export function usePmCompleteAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busyKey, setBusyKey] = useState(null);
  const mutation = useMutation({
    mutationFn: (target) => invokeWorkforce("recordMaintenanceCompletion", { action: "complete", ...target }),
  });
  const run = (key, target) => {
    if (busyKey) return;
    setBusyKey(key);
    mutation.mutate({ ...target, request_id: crypto.randomUUID() }, {
      onError: (e) => toast({ title: "הסימון לא נשמר", description: e.message, variant: "destructive" }),
      onSettled: async () => { await refreshAll(qc); setBusyKey(null); },
    });
  };
  return { run, busyKey };
}

export function usePmVoid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ event_id, reason }) => invokeWorkforce("recordMaintenanceCompletion", { action: "void", event_id, reason }),
    onSuccess: () => refreshAll(qc),
  });
}