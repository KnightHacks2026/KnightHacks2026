import { CONTRACT_VERSION, type GetTwinResponse } from "@/contracts";
import { fullFundingScenario } from "@/contracts/fixtures";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { projectSettlementBaseline } from "@/lib/simulation";
import { getSimulationDataset, simulationInputForDataset } from "@/lib/simulation/dataset";

export async function GET(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await context.params;
  const query = new URL(request.url).searchParams;
  const version = query.get("contractVersion");
  if (version !== null && version !== CONTRACT_VERSION) {
    return apiError("UNSUPPORTED_CONTRACT_VERSION", `Expected contract version ${CONTRACT_VERSION}.`, 400);
  }
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  const source = getSimulationDataset(datasetId);
  if (!source) return apiError("NOT_FOUND", "Dataset not found.", 404);
  if (query.has("snapshotId") && query.get("snapshotId") !== source.snapshot.id) {
    return apiError("NOT_FOUND", "Snapshot not found.", 404);
  }
  const input = simulationInputForDataset(source, fullFundingScenario, "baseline", source.snapshot.asOf);
  const data = { projection: projectSettlementBaseline(input) } satisfies Extract<GetTwinResponse, { ok: true }>["data"];
  return apiSuccess(data, 200, source.dataset.revision);
}
