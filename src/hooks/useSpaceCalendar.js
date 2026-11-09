import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Single read-only source for the visual spaces calendar (admins and VIEWER alike).
export default function useSpaceCalendar(start, end) {
  return useQuery({
    queryKey: ["space-visual-calendar", start, end],
    queryFn: async () => {
      const { data } = await base44.functions.invoke("getCommonSpacesCalendar", { start_date: start, end_date: end });
      if (!data?.success) throw new Error(data?.error || "טעינת היומן נכשלה");
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}