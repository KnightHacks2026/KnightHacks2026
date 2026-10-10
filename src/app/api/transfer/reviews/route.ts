import { apiSuccess } from "@/lib/api/envelope";
import { getTransferReviews } from "@/lib/data/repository";

/** Local demo only. This endpoint has no authenticated identity or institutional role. */
export async function GET() {
  return apiSuccess(await getTransferReviews());
}
