import { useQuery } from "@tanstack/react-query";
import { useRoleContext } from "@/lib/RoleContext";
import { invokeWorkforce } from "@/lib/workforceApi";

// Resolves the ACTIVE WorkerProfile linked to the signed-in internal user.
// Resolution happens on the server from the authenticated identity (never from client-supplied ids).
// Returns minimum data only: { id, full_name, default_team }.
// WorkShift.worker_id always refers to WorkerProfile.id, never to the auth/user id.
export default function useMyWorkerProfile(enabled = true) {
  const { internalUser } = useRoleContext();
  const email = (internalUser?.email || "").trim().toLowerCase();
  const { data: profile = null, isLoading } = useQuery({
    queryKey: ["myWorkerProfile", email],
    enabled: enabled && !!email,
    staleTime: 60000,
    queryFn: async () => (await invokeWorkforce("getWorkerDirectory", { action: "me" })).profile || null,
  });
  return { profile, isLoading, isActiveWorker: !!profile };
}