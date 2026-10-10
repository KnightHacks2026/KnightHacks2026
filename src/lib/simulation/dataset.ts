import { cascadeImport, cascadeSnapshot } from "@/contracts/fixtures";
import type { Dataset, FinancialSnapshot } from "@/contracts";
import type { SimulationInput } from "./index";

/** The only available dataset until the import/persistence service is connected. */
export function getSimulationDataset(datasetId: string) {
  if (datasetId !== cascadeImport.dataset.id) return null;
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
  };
}

export function simulationInputForDataset(
  source: NonNullable<ReturnType<typeof getSimulationDataset>>,
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
