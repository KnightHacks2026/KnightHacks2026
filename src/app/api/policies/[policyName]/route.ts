import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { getAuthenticatedUser, setExamplePolicyArchived, setExamplePolicyState } from "@/lib/data/repository";

const policyActionSchema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  action: z.enum(["archive", "restore"]),
});
const policyStateSchema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  state: z.enum(["Enforced", "Disabled"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ policyName: string }> }) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400);
  }

  const parsed = z.union([policyActionSchema, policyStateSchema]).safeParse(input);
  if (!parsed.success) return apiError("INVALID_REQUEST", "Choose a valid policy state or archive action.", 400);
  const actorId = await getAuthenticatedUser(request);
  if (!actorId) {
    return apiError("PERMISSION_DENIED", "The user is not authenticated.", 401);
  }
  if (actorId !== parsed.data.userId) return apiError("PERMISSION_DENIED", "You cannot update policies for another user.", 403);

  const { policyName } = await context.params;
  if ("action" in parsed.data) {
    const result = await setExamplePolicyArchived(parsed.data.userId, policyName, parsed.data.action === "archive");
    if (!result) return apiError("NOT_FOUND", "Policy not found.", 404);
    if (!result.ok) return apiError("REVISION_CONFLICT", "Policy state changed. Refresh the Policy Engine and try again.", 409);
    return apiSuccess({ state: result.state });
  }

  const result = await setExamplePolicyState(parsed.data.userId, policyName, parsed.data.state);
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") return apiError("NOT_FOUND", "Policy not found.", 404);
    return apiError("REVISION_CONFLICT", "Archived policies must be restored before they can be enabled or disabled.", 409);
  }
  return apiSuccess({ state: result.state });
}
