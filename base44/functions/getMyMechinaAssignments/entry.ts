import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { handleMyMechinaAssignments } from '../../shared/mechinaAccess.js';

// Own active Mechina group assignments of the signed-in MECHINA_USER (email matched case-insensitively).
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    return await handleMyMechinaAssignments(base44);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}