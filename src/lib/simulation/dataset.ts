import { cascadeImport, cascadeSnapshot } from "@/contracts/fixtures";
import type { Dataset, FinancialSnapshot } from "@/contracts";
import type { SimulationInput } from "./index";
import { getDemoUserId, getImportedDataset } from "@/lib/data/repository";

/** Resolve imported datasets within the authenticated account; the built-in
 * deterministic cascade is a read-only fixture shared by signed-in accounts. */
export async function getSimulationDataset(datasetId: string, userId = getDemoUserId()) {
  if (datasetId !== cascadeImport.dataset.id) return getImportedDataset(datasetId, userId);
  const dataset: Dataset = {
    ...cascadeImport.dataset,
    revision: cascadeSnapshot.datasetRevision,
    createdAt: cascadeSnapshot.asOf,
    status: "ready",
  };
  return {
    dataset,
    snapshot: structuredClone(cascadeSnapshot) as FinancialSnapshot,
    institutions: structuredClone(cascadeImport.institutions),
    accounts: structuredClone(cascadeImport.accounts),
    instruments: structuredClone(cascadeImport.instruments),
    dependencies: structuredClone(cascadeImport.dependencies),
    sourceRecords: structuredClone(cascadeImport.sourceRecords),
    auditEvents: [],
  };
}

export function simulationInputForDataset(
  source: NonNullable<Awaited<ReturnType<typeof getSimulationDataset>>>,
  request: SimulationInput["request"],
  resultId: string,
  createdAt: string,
): SimulationInput {
  return {
    request,
    snapshot: source.snapshot,
    accounts: source.accounts,
    instruments: source.instruments,
    dependencies: source.dependencies,
    resultId,
    createdAt,
  };
}
