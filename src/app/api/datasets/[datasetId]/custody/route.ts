import { CONTRACT_VERSION } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { assessCustody, CustodyValidationError } from "@/lib/custody";
import { getAuthenticatedUser } from "@/lib/data/repository";
import { getSimulationDataset } from "@/lib/simulation/dataset";

export async function GET(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in to view this dataset.", 401);
  const { datasetId } = await context.params;
  const version = new URL(request.url).searchParams.get("contractVersion");
  if (version !== null && version !== CONTRACT_VERSION) return apiError("UNSUPPORTED_CONTRACT_VERSION", `Expected contract version ${CONTRACT_VERSION}.`, 400);
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  const source = await getSimulationDataset(datasetId, userId);
  if (!source) return apiError("NOT_FOUND", "Dataset not found.", 404);
  try {
    const assessment = assessCustody({ snapshot: source.snapshot, accounts: source.accounts, instruments: source.instruments, dependencies: source.dependencies, sourceRecords: source.sourceRecords });
    return apiSuccess({ assessment }, 200, source.dataset.revision);
  } catch (error) {
    if (error instanceof CustodyValidationError) return apiError("VALIDATION_FAILED", error.message, 422);
    throw error;
  }
}
