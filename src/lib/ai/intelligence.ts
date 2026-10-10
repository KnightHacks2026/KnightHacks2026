import { createHash } from "node:crypto";
import { CONTRACT_VERSION, type Explanation, type FinancialReasonCode, type GetExplanationRequest, type Intervention, type RunSimulationRequest, type SimulationResult, type TwinProjection } from "@/contracts";
import { assessCustody, type CustodyAssessment } from "@/lib/custody";
import { projectSettlementBaseline, SIMULATION_MODEL_VERSION, simulateSettlement } from "@/lib/simulation";
import { simulationInputForDataset, type getSimulationDataset } from "@/lib/simulation/dataset";
import { simulationRequestSchema } from "@/lib/simulation/request-schema";

export type EvidenceDataset = NonNullable<Awaited<ReturnType<typeof getSimulationDataset>>>;
export type ExplanationSubject = Explanation["subject"];
/** Route extension until simulation results have a persisted lookup. */
export type SimulationExplanationRequest = GetExplanationRequest & { subject: { kind: "simulation"; id: string }; simulationRequest: RunSimulationRequest };
export interface Recommendation {
  id: string;
  kind: "cash_transfer" | "settlement_priority";
  summary: string;
  rationale: string;
  intervention: Intervention;
  simulationResultId: string;
  comparison: Extract<SimulationResult, { status: "valid" }>["comparison"];
  requiresHumanReview: true;
}
export interface RecommendationsData { recommendations: Recommendation[]; snapshotId: string }

const reasons: Record<FinancialReasonCode, string> = {
  SOURCE_RECORD_MISSING: "Supporting source data is missing",
  SOURCE_RECORD_DUPLICATE: "A source identity is duplicated",
  AMOUNT_MISMATCH: "The cash amount differs between records",
  CURRENCY_MISMATCH: "The currencies differ",
  QUANTITY_MISMATCH: "The security quantities differ",
  ACCOUNT_MISMATCH: "The account references differ",
  INSTRUMENT_MISMATCH: "The instrument references differ",
  SETTLEMENT_DATE_MISMATCH: "The settlement dates differ",
  CASH_SHORTFALL: "Available settled cash is insufficient",
  SECURITIES_SHORTFALL: "Available settled securities are insufficient",
  UPSTREAM_SETTLEMENT_BLOCKED: "An upstream obligation has not settled",
  COUNTERPARTY_DELAY: "A counterparty event is delayed",
  POSITION_CONFLICT: "Inventory has competing claims",
  DATA_STALE: "The input data is stale",
  POLICY_CONSTRAINT: "An operational policy prevents settlement",
};
const unique = <T>(items: T[]) => [...new Set(items)];
const resultId = (request: RunSimulationRequest) => `simulation-${createHash("sha256").update(JSON.stringify({ modelVersion: SIMULATION_MODEL_VERSION, request })).digest("hex").slice(0, 24)}`;

export function custodyEvidence(source: EvidenceDataset): CustodyAssessment {
  return assessCustody({ snapshot: source.snapshot, accounts: source.accounts, instruments: source.instruments, dependencies: source.dependencies, sourceRecords: source.sourceRecords });
}

export function baselineEvidence(source: EvidenceDataset): TwinProjection {
  const request = { contractVersion: CONTRACT_VERSION, datasetId: source.dataset.id, baseSnapshotId: source.snapshot.id, expectedDatasetRevision: source.dataset.revision, interventions: [] as unknown as RunSimulationRequest["interventions"] } satisfies RunSimulationRequest;
  return projectSettlementBaseline(simulationInputForDataset(source, request, "baseline", source.snapshot.asOf));
}

export function replayEvidence(source: EvidenceDataset, request: RunSimulationRequest): SimulationResult {
  const canonical = simulationRequestSchema.parse(request);
  return simulateSettlement(simulationInputForDataset(source, canonical, resultId(canonical), source.snapshot.asOf));
}

export function explain(source: EvidenceDataset, subject: ExplanationSubject, assessment: CustodyAssessment, baseline: TwinProjection, simulation?: SimulationResult): Explanation | null {
  const obligations = source.snapshot.obligations;
  let obligationIds: string[] = [];
  let sourceRecordIds: string[] = [];
  let reasonCodes: FinancialReasonCode[] = [];
  let summary: string;
  if (subject.kind === "exception") {
    const exception = assessment.exceptions.find(item => item.id === subject.id);
    if (!exception) return null;
    obligationIds = exception.obligationIds;
    sourceRecordIds = exception.sourceRecordIds;
    reasonCodes = [exception.reasonCode];
    summary = `${exception.summary} ${reasons[exception.reasonCode] ?? exception.reasonCode}. Evidence: ${sourceRecordIds.length ? sourceRecordIds.join(", ") : "no supporting source record"}.`;
  } else if (subject.kind === "obligation") {
    const obligation = obligations.find(item => item.id === subject.id);
    const projected = baseline.obligations.find(item => item.obligationId === subject.id);
    if (!obligation || !projected) return null;
    const custody = assessment.obligations.find(item => item.obligationId === subject.id);
    obligationIds = [obligation.id];
    sourceRecordIds = obligation.sourceRecordIds;
    reasonCodes = unique([...projected.reasonCodes, ...(custody?.reasonCodes ?? [])]);
    const asset = obligation.asset.kind === "cash" ? `${obligation.asset.currency} minor units` : `${obligation.asset.instrumentId} units`;
    const upstream = source.dependencies.filter(item => item.successorObligationId === obligation.id).map(item => item.predecessorObligationId);
    const cashCurrency = obligation.asset.kind === "cash" ? obligation.asset.currency : undefined;
    const securityInstrumentId = obligation.asset.kind === "security" ? obligation.asset.instrumentId : undefined;
    const cashBalance = cashCurrency ? source.snapshot.cashBalances.find(item => item.accountId === obligation.fromAccountId && item.currency === cashCurrency) : undefined;
    const securityBalance = securityInstrumentId ? source.snapshot.securitiesBalances.find(item => item.accountId === obligation.fromAccountId && item.instrumentId === securityInstrumentId) : undefined;
    const available = cashBalance ? (BigInt(cashBalance.settledMinorUnits) - BigInt(cashBalance.reservedMinorUnits)).toString() : securityBalance ? (BigInt(securityBalance.settledUnits) - BigInt(securityBalance.reservedUnits)).toString() : "0";
    summary = `Obligation ${obligation.id} is ${projected.status} in the settlement baseline and ${custody?.status ?? "unassessed"} in custody assessment. Remaining ${custody?.remainingUnits ?? "unknown"} ${asset}; available settled inventory at ${obligation.fromAccountId}: ${available} ${asset}. ${reasonCodes.length ? reasonCodes.map(code => reasons[code] ?? code).join("; ") : "No blocking reason was detected"}. ${upstream.length ? `Predecessors: ${upstream.join(", ")}.` : "No predecessor dependency."}`;
  } else {
    if (!simulation || simulation.id !== subject.id) return null;
    obligationIds = simulation.baseline.obligations.map(item => item.obligationId);
    sourceRecordIds = unique(obligations.filter(item => obligationIds.includes(item.id)).flatMap(item => item.sourceRecordIds));
    reasonCodes = unique(simulation.baseline.obligations.flatMap(item => item.reasonCodes));
    if (simulation.status === "invalid") {
      summary = `Simulation ${simulation.id} is invalid: ${simulation.validationIssues.map(item => `${item.code}: ${item.message}`).join("; ")}. No projected outcome exists.`;
    } else {
      summary = `Simulation ${simulation.id} projects ${simulation.comparison.blockedCountBefore} blocked obligations before and ${simulation.comparison.blockedCountAfter} after the proposed intervention. Newly settled: ${simulation.comparison.newlySettledObligationIds.join(", ") || "none"}. Still blocked: ${simulation.comparison.stillBlockedObligationIds.join(", ") || "none"}. This is a simulated outcome against snapshot ${source.snapshot.id}, not an executed settlement.`;
    }
  }
  return { id: `explanation:${source.snapshot.id}:${subject.kind}:${subject.id}`, datasetId: source.dataset.id, subject, generatedAt: new Date().toISOString(), model: "deterministic-rules-v1", summary, reasonCodes, sourceRecordIds, obligationIds, ...(subject.kind === "simulation" ? { simulationResultId: subject.id } : {}), requiresHumanReview: true };
}

export function recommend(source: EvidenceDataset, baseline: TwinProjection, assessment = custodyEvidence(source)): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const blocked = new Set(baseline.obligations.filter(item => item.status === "blocked").map(item => item.obligationId));
  const custodyReasons = new Map(assessment.obligations.map(item => [item.obligationId, item.reasonCodes]));
  const remediable = new Set<FinancialReasonCode>(["CASH_SHORTFALL", "UPSTREAM_SETTLEMENT_BLOCKED", "POSITION_CONFLICT"]);
  const noOtherBreaks = (ids: string[]) => ids.every(id => (custodyReasons.get(id) ?? []).every(code => remediable.has(code)));
  for (const obligation of source.snapshot.obligations) {
    if (!blocked.has(obligation.id) || obligation.asset.kind !== "cash") continue;
    const baselineItem = baseline.obligations.find(item => item.obligationId === obligation.id)!;
    if (!baselineItem.reasonCodes.includes("CASH_SHORTFALL")) continue;
    const currency = obligation.asset.currency;
    const current = source.snapshot.cashBalances.find(item => item.accountId === obligation.fromAccountId && item.currency === currency);
    const remaining = BigInt(obligation.requiredUnits) - BigInt(obligation.settledUnits);
    const available = current ? BigInt(current.settledMinorUnits) - BigInt(current.reservedMinorUnits) : 0n;
    const gap = remaining - available;
    if (gap <= 0n) continue;
    for (const balance of source.snapshot.cashBalances) {
      if (balance.accountId === obligation.fromAccountId || balance.currency !== obligation.asset.currency || BigInt(balance.settledMinorUnits) - BigInt(balance.reservedMinorUnits) < gap) continue;
      const sourceAccount = source.accounts.find(item => item.id === balance.accountId);
      const targetAccount = source.accounts.find(item => item.id === obligation.fromAccountId);
      if (sourceAccount?.status !== "open" || targetAccount?.status !== "open") continue;
      const intervention: Intervention = { id: `suggestion:${obligation.id}:${balance.accountId}`, kind: "cash_transfer", datasetId: source.dataset.id, baseSnapshotId: source.snapshot.id, expectedDatasetRevision: source.dataset.revision, rationale: `Simulate funding the ${gap} ${balance.currency} minor-unit shortfall on ${obligation.id} from available settled cash at ${balance.accountId}.`, sourceAccountId: balance.accountId, targetAccountId: obligation.fromAccountId, amount: { currency: balance.currency, minorUnits: gap.toString() as `${bigint}` }, effectiveAt: source.snapshot.asOf };
      const request: RunSimulationRequest = { contractVersion: CONTRACT_VERSION, datasetId: source.dataset.id, baseSnapshotId: source.snapshot.id, expectedDatasetRevision: source.dataset.revision, interventions: [intervention] };
      const result = replayEvidence(source, request);
      if (result.status !== "valid" || result.comparison.blockedCountAfter >= result.comparison.blockedCountBefore || result.comparison.newlySettledObligationIds.length === 0 || result.comparison.newlyAtRiskObligationIds.length > 0 || !noOtherBreaks(result.comparison.newlySettledObligationIds)) continue;
      recommendations.push({ id: intervention.id, kind: "cash_transfer", summary: `Simulated transfer of ${gap} ${balance.currency} minor units from ${balance.accountId} to ${obligation.fromAccountId} reduces blocked obligations from ${result.comparison.blockedCountBefore} to ${result.comparison.blockedCountAfter}.`, rationale: intervention.rationale, intervention, simulationResultId: result.id, comparison: result.comparison, requiresHumanReview: true });
    }
  }
  // Queue changes are suggested only when the engine demonstrates an improvement.
  for (const preferred of source.snapshot.obligations) {
    if (!blocked.has(preferred.id) || preferred.status === "cancelled") continue;
    for (const displaced of source.snapshot.obligations) {
      if (preferred.id === displaced.id || preferred.fromAccountId !== displaced.fromAccountId || preferred.asset.kind !== displaced.asset.kind || preferred.asset.kind === "cash" && displaced.asset.kind === "cash" && preferred.asset.currency !== displaced.asset.currency || preferred.asset.kind === "security" && displaced.asset.kind === "security" && preferred.asset.instrumentId !== displaced.asset.instrumentId) continue;
      const intervention: Intervention = { id: `suggestion:priority:${preferred.id}:${displaced.id}`, kind: "settlement_priority", datasetId: source.dataset.id, baseSnapshotId: source.snapshot.id, expectedDatasetRevision: source.dataset.revision, rationale: `Simulate processing ${preferred.id} ahead of ${displaced.id} while preserving dependency order.`, obligationId: preferred.id, aheadOfObligationId: displaced.id };
      const request: RunSimulationRequest = { contractVersion: CONTRACT_VERSION, datasetId: source.dataset.id, baseSnapshotId: source.snapshot.id, expectedDatasetRevision: source.dataset.revision, interventions: [intervention] };
      const result = replayEvidence(source, request);
      if (result.status !== "valid" || result.comparison.blockedCountAfter >= result.comparison.blockedCountBefore || result.comparison.newlySettledObligationIds.length === 0 || result.comparison.newlyAtRiskObligationIds.length > 0 || !noOtherBreaks(result.comparison.newlySettledObligationIds)) continue;
      recommendations.push({ id: intervention.id, kind: "settlement_priority", summary: `Simulated priority for ${preferred.id} ahead of ${displaced.id} reduces blocked obligations from ${result.comparison.blockedCountBefore} to ${result.comparison.blockedCountAfter}.`, rationale: intervention.rationale, intervention, simulationResultId: result.id, comparison: result.comparison, requiresHumanReview: true });
    }
  }
  return recommendations;
}
