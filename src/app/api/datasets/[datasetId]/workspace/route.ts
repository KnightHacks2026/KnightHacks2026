import { CONTRACT_VERSION, type GetWorkspaceResponse } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { getSimulationDataset } from "@/lib/simulation/dataset";

export async function GET(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await context.params;
  const version = new URL(request.url).searchParams.get("contractVersion");
  if (version !== null && version !== CONTRACT_VERSION) {
    return apiError("UNSUPPORTED_CONTRACT_VERSION", `Expected contract version ${CONTRACT_VERSION}.`, 400);
  }
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  const source = getSimulationDataset(datasetId);
  if (!source) return apiError("NOT_FOUND", "Dataset not found.", 404);
  const data = {
    dataset: source.dataset,
    snapshot: source.snapshot,
    institutions: source.institutions,
    accounts: source.accounts,
    instruments: source.instruments,
    exceptions: [],
    proposals: [],
    recentAuditEvents: [],
  } satisfies Extract<GetWorkspaceResponse, { ok: true }>["data"];
  return apiSuccess(data, 200, source.dataset.revision);
}
