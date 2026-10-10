import { CONTRACT_VERSION } from "@/contracts";
import { apiError, serviceNotConnected } from "@/lib/api/envelope";

export async function GET(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await context.params;
  const version = new URL(request.url).searchParams.get("contractVersion");
  if (version !== CONTRACT_VERSION) {
    return apiError("UNSUPPORTED_CONTRACT_VERSION", `Expected contract version ${CONTRACT_VERSION}.`, 400);
  }
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  return serviceNotConnected();
}
