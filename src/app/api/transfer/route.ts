import { z } from "zod";
import { CONTRACT_VERSION, type CreateTransferRequest } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { createExampleTransfer, getAuthenticatedUser } from "@/lib/data/repository";

const transferRequestSchema: z.ZodType<CreateTransferRequest> = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  userId: z.string().trim().min(1).max(128),
  assetType: z.string().trim().min(1).max(32).transform(value => value.toUpperCase()),
  assetAmount: z.string().trim().min(1).max(128)
    .regex(/^\d+(?:\.\d+)?$/, "Amount must be a positive decimal string.")
    .refine(value => /[1-9]/.test(value), "Amount must be greater than zero."),
  assetSource: z.string().trim().min(1).max(128),
  senderName: z.string().trim().min(1).max(128),
});

export async function POST(request: Request) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in before creating a transfer.", 401);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400);
  }

  const parsed = transferRequestSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("INVALID_REQUEST", "Invalid transfer request.", 400);
  }
  if (parsed.data.userId !== userId) {
    return apiError("PERMISSION_DENIED", "You cannot create a transfer for another user.", 403);
  }

  const result = await createExampleTransfer(parsed.data);
  if (!result.ok && result.reason === "ASSET_NOT_OWNED") {
    return apiError("NOT_FOUND", "The user does not own the specified asset source.", 404);
  }
  if (!result.ok) {
    return apiError("INVALID_REQUEST", "The asset type does not match the owned asset source.", 400);
  }

  return apiSuccess({ transaction: result.transaction }, 201);
}
