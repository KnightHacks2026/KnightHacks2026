import { createHash } from "node:crypto";
import type { RunSimulationResponse } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { readVersionedJson } from "@/lib/api/request";
import { getAuthenticatedUser } from "@/lib/data/repository";
import { getSimulationDataset, simulationInputForDataset } from "@/lib/simulation/dataset";
import { simulationRequestSchema } from "@/lib/simulation/request-schema";
import { SIMULATION_MODEL_VERSION, simulateSettlement } from "@/lib/simulation";

export async function POST(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in before running a simulation.", 401);
  const { datasetId } = await context.params;
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  const parsed = await readVersionedJson(request);
  if (!parsed.ok) return parsed.response;
  const body = simulationRequestSchema.safeParse(parsed.input);
  if (!body.success) return apiError("INVALID_REQUEST", "Invalid simulation request.", 400);
  if (body.data.datasetId !== datasetId) return apiError("INVALID_REQUEST", "Dataset ID does not match the route.", 400);
  const source = await getSimulationDataset(datasetId, userId);
  if (!source) return apiError("NOT_FOUND", "Dataset not found.", 404);
  if (body.data.baseSnapshotId !== source.snapshot.id) return apiError("NOT_FOUND", "Snapshot not found.", 404);
  if (body.data.expectedDatasetRevision !== source.dataset.revision) {
    return apiError("REVISION_CONFLICT", "Dataset revision has changed.", 409);
  }
  const resultId = `simulation-${createHash("sha256").update(JSON.stringify({ modelVersion: SIMULATION_MODEL_VERSION, request: body.data })).digest("hex").slice(0, 24)}`;
  const result = simulateSettlement(simulationInputForDataset(source, body.data, resultId, source.snapshot.asOf));
  const data = { result } satisfies Extract<RunSimulationResponse, { ok: true }>["data"];
  return apiSuccess(data, 200, source.dataset.revision);
}
