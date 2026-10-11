import { apiError, apiSuccess } from "@/lib/api/envelope";
import { getAuthenticatedUser, getTransferReviews } from "@/lib/data/repository";

export async function GET(request: Request) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in to view transfer reviews.", 401);
  return apiSuccess(await getTransferReviews(userId));
}
