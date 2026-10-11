import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { createExamplePolicy, hasAuthenticationUser } from "@/lib/data/repository";

const policySchema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(3).max(80),
  asset: z.string().trim().min(1).max(32).transform(value => value.toUpperCase()),
  threshold: z.string().trim().regex(/^\d+(?:\.\d+)?$/).refine(value => /[1-9]/.test(value), "Threshold must be greater than zero."),
});

export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); }
  catch { return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400); }

  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return apiError("INVALID_REQUEST", "Complete every policy field.", 400);
  if (!(await hasAuthenticationUser(parsed.data.userId))) {
    return apiError("PERMISSION_DENIED", "The user is not authenticated.", 401);
  }

  try {
    const policy = await createExamplePolicy({
      userId: parsed.data.userId,
      name: parsed.data.name,
      scope: "All new transfers",
      rule: `${parsed.data.asset} amount > ${parsed.data.threshold} · Human approval`,
      asset: parsed.data.asset,
      threshold: parsed.data.threshold,
    });
    return apiSuccess({ policy }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return apiError("INVALID_REQUEST", "A policy with this name already exists.", 409);
    }
    throw error;
  }
}
