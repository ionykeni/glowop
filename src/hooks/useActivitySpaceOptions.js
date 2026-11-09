import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Read-only list of existing activity spaces, used only as template references.
export default function useActivitySpaceOptions() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["activity-space-options"],
    queryFn: () => base44.entities.ActivitySpace.list("name", 200),
    staleTime: 5 * 60 * 1000,
  });
  const byId = Object.fromEntries(data.map(s => [s.id, s]));
  return { spaces: data, byId, isLoading };
}