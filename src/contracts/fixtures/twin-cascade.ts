import { CONTRACT_VERSION } from "../core";
import type { ImportDatasetRequest, RunSimulationRequest } from "../api";
import type { FinancialSnapshot } from "../entities";
import type { TwinProjection } from "../twin";

/** Synthetic, fixed-input fixture. Scenario requests contain no asserted simulation outcome. */
export const cascadeImport: ImportDatasetRequest = {
  contractVersion: CONTRACT_VERSION,
  dataset: {
    id: "dataset-cascade",
    contractVersion: CONTRACT_VERSION,
    name: "Three-leg settlement cascade",
    asOf: "2026-10-09T13:00:00Z",
  },
  institutions: [
    { id: "inst-custody", datasetId: "dataset-cascade", name: "Demo Custodian", role: "custodian" },
    { id: "inst-client", datasetId: "dataset-cascade", name: "Demo Client", role: "client" },
    { id: "inst-counterparty", datasetId: "dataset-cascade", name: "Demo Counterparty", role: "counterparty" },
  ],
  accounts: [
    { id: "acct-a", datasetId: "dataset-cascade", institutionId: "inst-client", externalId: "A", name: "Origin", kind: "omnibus", status: "open" },
    { id: "acct-b", datasetId: "dataset-cascade", institutionId: "inst-custody", externalId: "B", name: "Clearing", kind: "cash", status: "open" },
    { id: "acct-c", datasetId: "dataset-cascade", institutionId: "inst-counterparty", externalId: "C", name: "Intermediate", kind: "cash", status: "open" },
    { id: "acct-d", datasetId: "dataset-cascade", institutionId: "inst-counterparty", externalId: "D", name: "Destination", kind: "cash", status: "open" },
    { id: "acct-reserve", datasetId: "dataset-cascade", institutionId: "inst-client", externalId: "R", name: "Uncommitted Reserve", kind: "cash", status: "open" },
  ],
  instruments: [
    { id: "instrument-demo", datasetId: "dataset-cascade", symbol: "DEMO", name: "Demo Equity", assetClass: "equity", quantityScale: 0, identifiers: {} },
  ],
  sourceRecords: [
    { id: "source-1", datasetId: "dataset-cascade", sourceSystem: "demo-ledger", externalId: "trade-1", kind: "trade", occurredAt: "2026-10-09T12:00:00Z", receivedAt: "2026-10-09T12:01:00Z", accountId: "acct-a", amount: { currency: "USD", minorUnits: "10000" }, attributes: {} },
    { id: "source-2", datasetId: "dataset-cascade", sourceSystem: "demo-ledger", externalId: "trade-2", kind: "trade", occurredAt: "2026-10-09T12:02:00Z", receivedAt: "2026-10-09T12:03:00Z", accountId: "acct-b", amount: { currency: "USD", minorUnits: "10000" }, attributes: {} },
    { id: "source-3", datasetId: "dataset-cascade", sourceSystem: "demo-ledger", externalId: "trade-3", kind: "trade", occurredAt: "2026-10-09T12:04:00Z", receivedAt: "2026-10-09T12:05:00Z", accountId: "acct-c", amount: { currency: "USD", minorUnits: "10000" }, attributes: {} },
  ],
  obligations: [
    { id: "obligation-1", datasetId: "dataset-cascade", externalId: "leg-1", fromAccountId: "acct-a", toAccountId: "acct-b", asset: { kind: "cash", currency: "USD" }, requiredUnits: "10000", settledUnits: "0", dueAt: "2026-10-09T14:00:00Z", status: "blocked", sourceRecordIds: ["source-1"] },
    { id: "obligation-2", datasetId: "dataset-cascade", externalId: "leg-2", fromAccountId: "acct-b", toAccountId: "acct-c", asset: { kind: "cash", currency: "USD" }, requiredUnits: "10000", settledUnits: "0", dueAt: "2026-10-09T14:05:00Z", status: "blocked", sourceRecordIds: ["source-2"] },
    { id: "obligation-3", datasetId: "dataset-cascade", externalId: "leg-3", fromAccountId: "acct-c", toAccountId: "acct-d", asset: { kind: "cash", currency: "USD" }, requiredUnits: "10000", settledUnits: "0", dueAt: "2026-10-09T14:10:00Z", status: "blocked", sourceRecordIds: ["source-3"] },
  ],
  dependencies: [
    { id: "dependency-1-2", datasetId: "dataset-cascade", predecessorObligationId: "obligation-1", successorObligationId: "obligation-2", kind: "settlement_proceeds" },
    { id: "dependency-2-3", datasetId: "dataset-cascade", predecessorObligationId: "obligation-2", successorObligationId: "obligation-3", kind: "settlement_proceeds" },
  ],
  initialCashBalances: [
    { accountId: "acct-a", currency: "USD", settledMinorUnits: "9000", reservedMinorUnits: "0" },
    { accountId: "acct-b", currency: "USD", settledMinorUnits: "0", reservedMinorUnits: "0" },
    { accountId: "acct-c", currency: "USD", settledMinorUnits: "0", reservedMinorUnits: "0" },
    { accountId: "acct-d", currency: "USD", settledMinorUnits: "0", reservedMinorUnits: "0" },
    { accountId: "acct-reserve", currency: "USD", settledMinorUnits: "2000", reservedMinorUnits: "0" },
  ],
  initialSecuritiesBalances: [
    { accountId: "acct-a", instrumentId: "instrument-demo", settledUnits: "25", reservedUnits: "0" },
  ],
};

export const cascadeSnapshot: FinancialSnapshot = {
  id: "snapshot-cascade-1",
  datasetId: "dataset-cascade",
  datasetRevision: "1",
  asOf: "2026-10-09T13:00:00Z",
  cashBalances: cascadeImport.initialCashBalances,
  securitiesBalances: cascadeImport.initialSecuritiesBalances,
  obligations: cascadeImport.obligations,
};

export const cascadeBaselineProjection: TwinProjection = {
  datasetId: "dataset-cascade",
  snapshotId: "snapshot-cascade-1",
  asOf: "2026-10-09T13:00:00Z",
  obligations: [
    { obligationId: "obligation-1", status: "blocked", reasonCodes: ["CASH_SHORTFALL"], settledUnits: "0" },
    { obligationId: "obligation-2", status: "blocked", reasonCodes: ["UPSTREAM_SETTLEMENT_BLOCKED"], settledUnits: "0" },
    { obligationId: "obligation-3", status: "blocked", reasonCodes: ["UPSTREAM_SETTLEMENT_BLOCKED"], settledUnits: "0" },
  ],
  dependencies: cascadeImport.dependencies,
  cashBalances: cascadeImport.initialCashBalances,
  securitiesBalances: cascadeImport.initialSecuritiesBalances,
};

/** Covers the 1,000-cent shortfall using existing, unreserved cash. */
export const fullFundingScenario = {
  contractVersion: CONTRACT_VERSION,
  datasetId: "dataset-cascade",
  expectedDatasetRevision: "1",
  baseSnapshotId: "snapshot-cascade-1",
  interventions: [{
    id: "intervention-full-funding",
    datasetId: "dataset-cascade",
    baseSnapshotId: "snapshot-cascade-1",
    expectedDatasetRevision: "1",
    kind: "cash_transfer",
    sourceAccountId: "acct-reserve",
    targetAccountId: "acct-a",
    amount: { currency: "USD", minorUnits: "1000" },
    effectiveAt: "2026-10-09T13:05:00Z",
    rationale: "Test a funded transfer from the uncommitted reserve.",
  }],
} satisfies RunSimulationRequest;

/** Tests a smaller transfer while leaving all other inputs identical. */
export const partialFundingScenario = {
  contractVersion: CONTRACT_VERSION,
  datasetId: "dataset-cascade",
  expectedDatasetRevision: "1",
  baseSnapshotId: "snapshot-cascade-1",
  interventions: [{
    id: "intervention-partial-funding",
    datasetId: "dataset-cascade",
    baseSnapshotId: "snapshot-cascade-1",
    expectedDatasetRevision: "1",
    kind: "cash_transfer",
    sourceAccountId: "acct-reserve",
    targetAccountId: "acct-a",
    amount: { currency: "USD", minorUnits: "500" },
    effectiveAt: "2026-10-09T13:05:00Z",
    rationale: "Test a partial transfer from the same reserve.",
  }],
} satisfies RunSimulationRequest;
