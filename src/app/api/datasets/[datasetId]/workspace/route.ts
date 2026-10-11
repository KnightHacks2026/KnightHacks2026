import { CONTRACT_VERSION, type GetWorkspaceResponse } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { getAuthenticatedUser } from "@/lib/data/repository";
import { getSimulationDataset } from "@/lib/simulation/dataset";

export async function GET(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in to view this dataset.", 401);
  const { datasetId } = await context.params;
  const version = new URL(request.url).searchParams.get("contractVersion");
  if (version !== null && version !== CONTRACT_VERSION) {
    return apiError("UNSUPPORTED_CONTRACT_VERSION", `Expected contract version ${CONTRACT_VERSION}.`, 400);
  }
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  const source = await getSimulationDataset(datasetId, userId);
  if (!source) return apiError("NOT_FOUND", "Dataset not found.", 404);
  const data = {
    dataset: source.dataset,
    snapshot: source.snapshot,
    institutions: source.institutions,
    accounts: source.accounts,
    instruments: source.instruments,
    exceptions: [],
    proposals: [],
    recentAuditEvents: source.auditEvents,
  } satisfies Extract<GetWorkspaceResponse, { ok: true }>["data"];
  return apiSuccess(data, 200, source.dataset.revision);
}
