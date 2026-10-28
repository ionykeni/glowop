import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleContext } from "@/lib/RoleContext";

// Resolves the ACTIVE WorkerProfile linked to the signed-in internal user
// (by internal_user_id first, then by confirmed internal_user_email).
// WorkShift.worker_id always refers to WorkerProfile.id, never to the auth/user id.
export default function useMyWorkerProfile(enabled = true) {
  const { internalUser } = useRoleContext();
  const internalUserId = internalUser?.id || "";
  const email = (internalUser?.email || "").trim().toLowerCase();
  const { data: profile = null, isLoading } = useQuery({
    queryKey: ["myWorkerProfile", internalUserId, email],
    enabled: enabled && (!!internalUserId || !!email),
    staleTime: 60000,
    queryFn: async () => {
      if (internalUserId) {
        const byId = await base44.entities.WorkerProfile.filter({ internal_user_id: internalUserId });
        const hit = byId.find((p) => p.is_active !== false);
        if (hit) return hit;
      }
      const byEmail = await base44.entities.WorkerProfile.filter({ internal_user_email: email });
      return byEmail.find((p) => p.is_active !== false) || null;
    },
  });
  return { profile, isLoading, isActiveWorker: !!profile };
}