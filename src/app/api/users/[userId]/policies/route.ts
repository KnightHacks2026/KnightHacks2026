import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { createExamplePolicy, getAuthenticatedUser } from "@/lib/data/repository";

const policyInput = z.strictObject({
  name: z.string().trim().min(3).max(80),
  scope: z.string().trim().min(3).max(120),
  rule: z.string().trim().min(3).max(240),
});

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  if (!userId.trim() || userId.length > 128) return apiError("INVALID_REQUEST", "A valid user ID is required.", 400);
  const actorId = await getAuthenticatedUser(request);
  if (!actorId) return apiError("PERMISSION_DENIED", "Sign in to create a policy.", 401);
  if (actorId !== userId) return apiError("PERMISSION_DENIED", "You cannot create policies for another user.", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_REQUEST", "Enter valid policy details.", 400); }
  const parsed = policyInput.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_FAILED", parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "), 400);
  try {
    return apiSuccess(await createExamplePolicy(userId, parsed.data), 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return apiError("REVISION_CONFLICT", "A policy with that name already exists.", 409);
    }
    throw error;
  }
}
