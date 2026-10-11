import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { createExamplePolicy, getExampleData, hasAuthenticationUser, PolicyArchiveConflictError, PolicyNameConflictError } from "@/lib/data/repository";

const positiveDecimal = z.string()
  .trim()
  .regex(/^\d{1,18}(?:\.\d{1,18})?$/, "Enter a positive amount using up to 18 digits.")
  .refine(value => /[1-9]/.test(value), "Threshold must be greater than zero.")
  .transform(value => {
    const [whole, fraction = ""] = value.split(".");
    const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
    const normalizedFraction = fraction.replace(/0+$/, "");
    return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
  });

const policySchema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(3).max(80),
  asset: z.string().trim().min(1).max(32).transform(value => value.toUpperCase()),
  threshold: positiveDecimal,
  archivePolicyNames: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
});

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400);
  }

  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return apiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Complete every policy field.", 400);
  const { userId, name, asset, threshold, archivePolicyNames } = parsed.data;
  if (!(await hasAuthenticationUser(userId))) {
    return apiError("PERMISSION_DENIED", "The user is not authenticated.", 401);
  }

  const assets = (await getExampleData(userId)).assets;
  if (!assets.some(row => row.symbol === asset && row.symbol !== "OTHER")) {
    return apiError("INVALID_REQUEST", "Choose an asset available in the current workspace.", 400);
  }

  try {
    const policy = await createExamplePolicy({ userId, name, asset, threshold, archivePolicyNames });
    return apiSuccess({ policy, archivedPolicyNames: [...new Set(archivePolicyNames)] }, 201);
  } catch (error) {
    if (error instanceof PolicyNameConflictError) {
      return apiError("INVALID_REQUEST", error.message, 409);
    }
    if (error instanceof PolicyArchiveConflictError) {
      return apiError("REVISION_CONFLICT", error.message, 409);
    }
    throw error;
  }
}
