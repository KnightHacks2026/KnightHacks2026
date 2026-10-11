import { CONTRACT_VERSION } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { baselineEvidence, custodyEvidence, recommend, type RecommendationsData } from "@/lib/ai/intelligence";
import { CustodyValidationError } from "@/lib/custody";
import { getAuthenticatedUser } from "@/lib/data/repository";
import { getSimulationDataset } from "@/lib/simulation/dataset";

export async function GET(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in to view this dataset.", 401);
  const { datasetId } = await context.params;
  const version = new URL(request.url).searchParams.get("contractVersion");
  if (version !== null && version !== CONTRACT_VERSION) return apiError("UNSUPPORTED_CONTRACT_VERSION", `Expected contract version ${CONTRACT_VERSION}.`, 400);
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  try {
    const source = await getSimulationDataset(datasetId, userId);
    if (!source) return apiError("NOT_FOUND", "Dataset not found.", 404);
    const assessment = custodyEvidence(source);
    const recommendations = recommend(source, baselineEvidence(source), assessment);
    const data = { recommendations, snapshotId: source.snapshot.id } satisfies RecommendationsData;
    return apiSuccess(data, 200, source.dataset.revision);
  } catch (error) {
    if (error instanceof CustodyValidationError) return apiError("VALIDATION_FAILED", error.message, 422, error.issues);
    return apiError("INTERNAL_ERROR", "Could not generate recommendations.", 500);
  }
}
