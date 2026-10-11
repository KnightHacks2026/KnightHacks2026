import { cascadeImport, cascadeSnapshot } from "@/contracts/fixtures";
import type { Dataset, FinancialSnapshot } from "@/contracts";
import type { SimulationInput } from "./index";
import { getDemoUserId, getImportedDataset } from "@/lib/data/repository";

/** Resolve a dataset only within the authenticated account's namespace. */
// Keep the demo default for existing internal fixture consumers. API routes must pass
// the authenticated account explicitly; all route handlers do so.
export async function getSimulationDataset(datasetId: string, userId = getDemoUserId()) {
  if (datasetId !== cascadeImport.dataset.id) return getImportedDataset(datasetId, userId);
  // The built-in cascade is a demo account fixture, not a shared workspace.
  if (userId !== getDemoUserId()) return null;
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
