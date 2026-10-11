import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { hasAuthenticationUser, setExamplePolicyState } from "@/lib/data/repository";

const schema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  state: z.enum(["Enforced", "Disabled"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ policyName: string }> }) {
  let input: unknown;
  try { input = await request.json(); }
  catch { return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid policy state.", 400);
  if (!(await hasAuthenticationUser(parsed.data.userId))) return apiError("PERMISSION_DENIED", "The user is not authenticated.", 401);
  const { policyName } = await context.params;
  const state = await setExamplePolicyState(parsed.data.userId, decodeURIComponent(policyName), parsed.data.state);
  return state ? apiSuccess({ state }) : apiError("NOT_FOUND", "Policy not found.", 404);
}
