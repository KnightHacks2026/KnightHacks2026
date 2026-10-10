import { apiError, serviceNotConnected } from "@/lib/api/envelope";
import { readVersionedJson } from "@/lib/api/request";

export async function POST(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await context.params;
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  const parsed = await readVersionedJson(request);
  if (!parsed.ok) return parsed.response;
  return serviceNotConnected();
}
