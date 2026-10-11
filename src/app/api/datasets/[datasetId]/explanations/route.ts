import { z } from "zod";
import type { GetExplanationResponse } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { readVersionedJson } from "@/lib/api/request";
import { getAuthenticatedUser } from "@/lib/data/repository";
import { baselineEvidence, custodyEvidence, explain, replayEvidence } from "@/lib/ai/intelligence";
import { getSimulationDataset } from "@/lib/simulation/dataset";
import { simulationRequestSchema } from "@/lib/simulation/request-schema";
import { CustodyValidationError } from "@/lib/custody";

const schema = z.strictObject({
  contractVersion: z.literal("1.0.0"),
  datasetId: z.string().min(1),
  subject: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("exception"), id: z.string().min(1) }),
    z.strictObject({ kind: z.literal("obligation"), id: z.string().min(1) }),
    z.strictObject({ kind: z.literal("simulation"), id: z.string().min(1) }),
  ]),
  simulationRequest: simulationRequestSchema.optional(),
}).refine(value => value.subject.kind === "simulation" ? !!value.simulationRequest : !value.simulationRequest);

export async function POST(request: Request, context: { params: Promise<{ datasetId: string }> }) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in to request an explanation.", 401);
  const { datasetId } = await context.params;
  if (!datasetId) return apiError("INVALID_REQUEST", "A dataset ID is required.", 400);
  const parsed = await readVersionedJson(request);
  if (!parsed.ok) return parsed.response;
  const body = schema.safeParse(parsed.input);
  if (!body.success || body.data.datasetId !== datasetId) return apiError("INVALID_REQUEST", "Invalid explanation request.", 400);
  try {
    const source = await getSimulationDataset(datasetId, userId);
    if (!source) return apiError("NOT_FOUND", "Dataset not found.", 404);
    const simulationRequest = body.data.simulationRequest;
    if (simulationRequest) {
      if (simulationRequest.datasetId !== datasetId || simulationRequest.baseSnapshotId !== source.snapshot.id) return apiError("INVALID_REQUEST", "Simulation evidence does not match the dataset snapshot.", 400);
      if (simulationRequest.expectedDatasetRevision !== source.dataset.revision) return apiError("REVISION_CONFLICT", "Dataset revision has changed.", 409);
    }
    const assessment = custodyEvidence(source);
    const baseline = baselineEvidence(source);
    const simulation = simulationRequest ? replayEvidence(source, simulationRequest) : undefined;
    const explanation = explain(source, body.data.subject, assessment, baseline, simulation);
    if (!explanation) return apiError("NOT_FOUND", "Explanation subject not found.", 404);
    const data = { explanation } satisfies Extract<GetExplanationResponse, { ok: true }>["data"];
    return apiSuccess(data, 200, source.dataset.revision);
  } catch (error) {
    if (error instanceof CustodyValidationError) return apiError("VALIDATION_FAILED", error.message, 422, error.issues);
    return apiError("INTERNAL_ERROR", "Could not generate an explanation.", 500);
  }
}
