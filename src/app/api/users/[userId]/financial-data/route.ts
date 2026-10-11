import { apiError, apiSuccess } from "@/lib/api/envelope";
import { getFinancialDataForUser, hasAuthenticationUser } from "@/lib/data/repository";

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  if (!userId.trim() || userId.length > 128) {
    return apiError("INVALID_REQUEST", "A user ID between 1 and 128 characters is required.", 400);
  }
  if (!(await hasAuthenticationUser(userId))) {
    return apiError("PERMISSION_DENIED", "The user is not authenticated.", 401);
  }

  return apiSuccess(await getFinancialDataForUser(userId));
}
