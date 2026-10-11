import { apiError, apiSuccess } from "@/lib/api/envelope";
import { getAuthenticatedUser, getFinancialDataForUser } from "@/lib/data/repository";

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  if (!userId.trim() || userId.length > 128) {
    return apiError("INVALID_REQUEST", "A user ID between 1 and 128 characters is required.", 400);
  }
  const actorId = await getAuthenticatedUser(request);
  if (!actorId) {
    return apiError("PERMISSION_DENIED", "The user is not authenticated.", 401);
  }
  if (actorId !== userId) return apiError("PERMISSION_DENIED", "You cannot access another user's financial data.", 403);

  return apiSuccess(await getFinancialDataForUser(userId));
}
